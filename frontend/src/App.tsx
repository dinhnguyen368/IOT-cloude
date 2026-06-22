import { useEffect, useState, useRef } from 'react';
import axios from 'axios';
import { MapContainer, TileLayer, Marker, Polyline, Popup, Rectangle } from 'react-leaflet';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip as RechartsTooltip, Legend } from 'recharts';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import * as signalR from '@microsoft/signalr'; // <-- IMPORT SIGNALR ĐỂ NHẬN DỮ LIỆU REAL-TIME

import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';
const DefaultIcon = L.icon({ iconUrl: icon, shadowUrl: iconShadow, iconSize: [25, 41], iconAnchor: [12, 41] });
const AlertSpeedIcon = L.icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
  iconSize: [25, 41], iconAnchor: [12, 41]
});
const AlertTempIcon = L.icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-orange.png', 
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
  iconSize: [25, 41], iconAnchor: [12, 41]
});
const ParkingIcon = L.icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-gold.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
  iconSize: [25, 41], iconAnchor: [12, 41]
});

// --- CẤU HÌNH GEOFENCE ---
const GEOFENCE_BOUNDS: [number, number][] = [
  [10.7700, 106.6950], [10.7800, 106.7050]
];
const isInsideGeofence = (lat: number, lng: number) => {
  return lat >= GEOFENCE_BOUNDS[0][0] && lat <= GEOFENCE_BOUNDS[1][0] && lng >= GEOFENCE_BOUNDS[0][1] && lng <= GEOFENCE_BOUNDS[1][1];
};

export default function App() {
  const [history, setHistory] = useState<any[]>([]);
  const [analytics, setAnalytics] = useState({ averageSpeed: 0, maxSpeed: 0, driverScore: 100, totalRecords: 0, estimatedFuel: 0 });
  const [parkingSpots, setParkingSpots] = useState<any[]>([]);
  const [driverVehicleId, setDriverVehicleId] = useState<string>('TRUCK_HCM_01');
  
  const [geofenceAlerts, setGeofenceAlerts] = useState<string[]>([]);
  const previousZoneStatus = useRef<Record<string, boolean>>({});

  // Hàm gọi API chỉ dùng 1 lần duy nhất lúc khởi động web
  const fetchData = async () => {
    try {
      const [histRes, anlRes, parkRes] = await Promise.all([
        axios.get('http://localhost:5230/api/tracking/history'),
        axios.get('http://localhost:5230/api/tracking/analytics'),
        axios.get('http://localhost:5230/api/parking')
      ]);
      setHistory(histRes.data);
      setAnalytics(anlRes.data);
      setParkingSpots(parkRes.data);
    } catch (e) { console.error("Lỗi API:", e); }
  };

  // --- LOGIC WEBSOCKETS (SIGNALR) ---
  useEffect(() => {
    // 1. Tải dữ liệu ban đầu
    fetchData();

    // 2. Thiết lập kết nối WebSockets với Backend
    const connection = new signalR.HubConnectionBuilder()
      .withUrl("http://localhost:5230/trackingHub")
      .withAutomaticReconnect()
      .build();

    connection.start()
      .then(() => console.log("🟢 Đã kết nối WebSockets thời gian thực thành công!"))
      .catch(err => console.error("🔴 Lỗi kết nối WebSockets:", err));

    // 3. Lắng nghe Tọa độ mới từ Backend đẩy xuống
    connection.on("ReceiveNewLog", (newLog) => {
      setHistory(prevHistory => [newLog, ...prevHistory]);
    });

    // 4. Lắng nghe Thống kê phân tích mới từ Backend đẩy xuống
    connection.on("UpdateAnalytics", (newAnalytics) => {
      setAnalytics(newAnalytics);
    });

    // 5. Ngắt kết nối khi tắt trang web
    return () => {
      connection.stop();
    };
  }, []);

  const groupedData: Record<string, any[]> = history.reduce((acc, curr) => {
    if (!acc[curr.vehicleId]) acc[curr.vehicleId] = [];
    acc[curr.vehicleId].push(curr);
    return acc;
  }, {});
  const vehicleIds = Object.keys(groupedData);
  
  // KIỂM TRA CẢNH BÁO
  const overSpeedingTrucks = vehicleIds.map(id => groupedData[id][0]).filter(t => t && t.speed > 60);
  const brokenColdChainTrucks = vehicleIds.map(id => groupedData[id][0]).filter(t => t && t.temperature > 8);

  useEffect(() => {
    const newAlerts: string[] = [];
    vehicleIds.forEach(id => {
      const latestPoint = groupedData[id][0];
      if (!latestPoint) return;
      const currentlyInside = isInsideGeofence(latestPoint.latitude, latestPoint.longitude);
      const wasInside = previousZoneStatus.current[id];
      if (wasInside !== undefined && wasInside !== currentlyInside) {
        const time = new Date(latestPoint.timestamp).toLocaleTimeString();
        const action = currentlyInside ? '📥 VỪA ĐI VÀO' : '📤 VỪA RỜI KHỎI';
        newAlerts.push(`[${time}] Xe ${id} ${action} Tổng Kho Quận 1!`);
      }
      previousZoneStatus.current[id] = currentlyInside;
    });
    if (newAlerts.length > 0) setGeofenceAlerts(prev => [...newAlerts, ...prev].slice(0, 5));
  }, [history]);

  const handleBookSpot = async (spotId: number) => {
    try {
      const res = await axios.post(`http://localhost:5230/api/parking/book?vehicleId=${driverVehicleId}&spotId=${spotId}`);
      alert(`✅ ${res.data.message}`);
      fetchData(); // Vẫn gọi lại API để làm mới riêng phần bãi đỗ xe
    } catch (error: any) { alert(`❌ Lỗi: ${error.response?.data || 'Không thể đặt chỗ'}`); }
  };

  const pieData = vehicleIds.map(id => ({ name: id, value: groupedData[id].length }));
  const PIE_COLORS = ['#3498db', '#2ecc71', '#f1c40f', '#e74c3c'];

  return (
    <div style={{ backgroundColor: '#f4f7f6', minHeight: '100vh', color: '#2c3e50', padding: '20px', fontFamily: 'sans-serif' }}>
      
      {/* HEADER & TÀI XẾ */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h1 style={{ margin: 0, color: '#2c3e50' }}>📊 OMNI-LOGISTICS DASHBOARD</h1>
        <div style={{ background: '#f1c40f', padding: '10px 20px', borderRadius: '8px', fontWeight: 'bold' }}>
          👨‍✈️ Đang lái: 
          <select value={driverVehicleId} onChange={(e) => setDriverVehicleId(e.target.value)} style={{ marginLeft: '10px', padding: '5px' }}>
            <option value="TRUCK_HCM_01">TRUCK_HCM_01</option>
            <option value="TRUCK_HCM_02">TRUCK_HCM_02</option>
            <option value="TRUCK_HCM_03">TRUCK_HCM_03</option>
          </select>
        </div>
      </div>

      {/* KHUNG CẢNH BÁO TỐC ĐỘ */}
      {overSpeedingTrucks.length > 0 && (
        <div style={{ backgroundColor: '#e74c3c', color: 'white', padding: '10px', borderRadius: '8px', marginBottom: '10px', textAlign: 'center', animation: 'blink 1s infinite' }}>
          ⚠️ <strong>CẢNH BÁO TỐC ĐỘ:</strong> Có {overSpeedingTrucks.length} xe đang vượt quá 60 km/h ({overSpeedingTrucks.map(t=>t.vehicleId).join(', ')})!
        </div>
      )}

      {/* KHUNG CẢNH BÁO CHUỖI LẠNH (COLD CHAIN) */}
      {brokenColdChainTrucks.length > 0 && (
        <div style={{ backgroundColor: '#e67e22', color: 'white', padding: '10px', borderRadius: '8px', marginBottom: '20px', textAlign: 'center', animation: 'blink 1.5s infinite' }}>
          ❄️ <strong>SỰ CỐ CHUỖI LẠNH:</strong> Lô hàng trên {brokenColdChainTrucks.length} xe đang gặp nguy hiểm do máy lạnh hỏng (Nhiệt độ &gt; 8°C)!
        </div>
      )}

      {/* THẺ THỐNG KÊ */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '15px', marginBottom: '20px' }}>
        {[
          { label: 'Điểm An Toàn', val: `${analytics.driverScore}/100`, color: '#27ae60', icon: '🛡️' },
          { label: 'Nhiên Liệu', val: `${analytics.estimatedFuel} Lít`, color: '#d35400', icon: '⛽' },
          { label: 'Tốc Độ TB', val: `${analytics.averageSpeed} km/h`, color: '#2980b9', icon: '⏱️' },
          { label: 'Tốc Độ Max', val: `${analytics.maxSpeed} km/h`, color: '#c0392b', icon: '🚀' },
          { label: 'Tổng Bản Ghi', val: analytics.totalRecords, color: '#8e44ad', icon: '📡' }
        ].map((c, i) => (
          <div key={i} style={{ background: 'white', padding: '15px', borderRadius: '8px', textAlign: 'center', borderBottom: `4px solid ${c.color}`, boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
            <div style={{ fontSize: '20px' }}>{c.icon}</div>
            <p style={{ margin: '5px 0', fontSize: '12px', fontWeight: 'bold', color: '#7f8c8d' }}>{c.label.toUpperCase()}</p>
            <h3 style={{ margin: 0, color: c.color }}>{c.val}</h3>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '20px' }}>
        
        {/* BẢN ĐỒ */}
        <div style={{ height: '550px', background: 'white', borderRadius: '8px', padding: '10px', boxShadow: '0 4px 6px rgba(0,0,0,0.05)' }}>
          <MapContainer center={[10.79, 106.68]} zoom={13} style={{ height: '100%', borderRadius: '4px' }}>
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            
            <Rectangle bounds={GEOFENCE_BOUNDS} pathOptions={{ color: '#8e44ad', fillColor: '#8e44ad', fillOpacity: 0.2 }}>
              <Popup><strong>🏭 Tổng Kho Quận 1</strong></Popup>
            </Rectangle>

            {/* VẼ XE VỚI THÔNG TIN NHIỆT ĐỘ */}
            {vehicleIds.map((id, index) => {
              const path = groupedData[id];
              const latest = path[0];
              const isOverSpeeding = latest.speed > 60;
              const isBrokenColdChain = latest.temperature > 8;
              
              // Chọn Icon phù hợp
              let currentIcon = DefaultIcon;
              if (isOverSpeeding) currentIcon = AlertSpeedIcon;
              if (isBrokenColdChain) currentIcon = AlertTempIcon; 

              return (
                <div key={id}>
                  <Marker position={[latest.latitude, latest.longitude]} icon={currentIcon}>
                    <Popup>
                      <strong style={{ fontSize: '16px', color: '#2c3e50' }}>{id}</strong> <br/><br/>
                      🚚 Tốc độ: <span style={{color: isOverSpeeding ? 'red' : 'green', fontWeight:'bold'}}>{latest.speed} km/h</span><br/>
                      ❄️ Nhiệt độ: <span style={{color: isBrokenColdChain ? 'red' : '#2980b9', fontWeight:'bold'}}>{latest.temperature} °C</span><br/>
                      💧 Độ ẩm: <strong>{latest.humidity} %</strong>
                    </Popup>
                  </Marker>
                  <Polyline positions={path.map(p => [p.latitude, p.longitude]) as any} color={PIE_COLORS[index % PIE_COLORS.length]} weight={4} opacity={0.8} />
                </div>
              );
            })}

            {/* VẼ BÃI ĐỖ XE */}
            {parkingSpots.map((spot) => (
              <Marker key={spot.id} position={[spot.latitude, spot.longitude]} icon={ParkingIcon}>
                <Popup>
                  <div style={{ textAlign: 'center' }}>
                    <h4 style={{ margin: '0 0 5px 0' }}>{spot.name}</h4>
                    {spot.isAvailable ? (
                      <button onClick={() => handleBookSpot(spot.id)} style={{ background: '#27ae60', color: 'white', border: 'none', padding: '5px 10px', borderRadius: '4px', cursor: 'pointer' }}>Đặt Chỗ</button>
                    ) : (
                      <span style={{ color: 'red', fontSize: '12px' }}>Đã đặt bởi:<br/> {spot.bookedByVehicleId}</span>
                    )}
                  </div>
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        </div>

        {/* CỘT BÊN PHẢI (GEOFENCE LOG & PIE CHART) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
          <div style={{ background: 'white', padding: '15px', borderRadius: '8px', boxShadow: '0 4px 6px rgba(0,0,0,0.05)', flexGrow: 1 }}>
            <h3 style={{ margin: '0 0 15px 0', color: '#8e44ad', borderBottom: '2px solid #ecf0f1', paddingBottom: '10px' }}>
              📍 Nhật Ký Ra/Vào Kho
            </h3>
            {geofenceAlerts.length === 0 ? (
              <p style={{ color: '#7f8c8d', fontStyle: 'italic', fontSize: '14px' }}>Chưa có phương tiện nào di chuyển qua cổng kho...</p>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: '14px' }}>
                {geofenceAlerts.map((alert, idx) => (
                  <li key={idx} style={{ padding: '8px 0', borderBottom: '1px dashed #bdc3c7', color: alert.includes('VÀO') ? '#27ae60' : '#d35400', fontWeight: 'bold' }}>
                    {alert}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div style={{ background: 'white', padding: '15px', borderRadius: '8px', boxShadow: '0 4px 6px rgba(0,0,0,0.05)', height: '250px' }}>
            <h4 style={{ textAlign: 'center', margin: '0 0 10px 0', color: '#34495e' }}>Phân bổ Dữ liệu</h4>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={60} label>
                  {pieData.map((_, index) => <Cell key={index} fill={PIE_COLORS[index % PIE_COLORS.length]} />)}
                </Pie>
                <RechartsTooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>

        </div>
      </div>
    </div>
  );
}