import { useEffect, useState, useRef } from 'react';
import axios from 'axios';
import { MapContainer, TileLayer, Marker, Polyline, Popup, Rectangle } from 'react-leaflet';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip as RechartsTooltip } from 'recharts';
import * as signalR from '@microsoft/signalr';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';
const BASE_URL = "https://iot-cloude.onrender.com";
const DefaultIcon = L.icon({ iconUrl: icon, shadowUrl: iconShadow, iconSize: [25, 41], iconAnchor: [12, 41] });
const AlertSpeedIcon = L.icon({ iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png', shadowUrl: iconShadow, iconSize: [25, 41], iconAnchor: [12, 41] });
const AlertTempIcon = L.icon({ iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-orange.png', shadowUrl: iconShadow, iconSize: [25, 41], iconAnchor: [12, 41] });
const ParkingIcon = L.icon({ iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-gold.png', shadowUrl: iconShadow, iconSize: [25, 41], iconAnchor: [12, 41] });

// --- CẤU HÌNH KHÔNG GIAN GEOFENCE & MÀU SẮC TOÀN CỤC ---
const GEOFENCE_BOUNDS: [number, number][] = [[10.7700, 106.6950], [10.7800, 106.7050]];
const isInsideGeofence = (lat: number, lng: number) => lat >= GEOFENCE_BOUNDS[0][0] && lat <= GEOFENCE_BOUNDS[1][0] && lng >= GEOFENCE_BOUNDS[0][1] && lng <= GEOFENCE_BOUNDS[1][1];

const PIE_COLORS = ['#0ea5e9', '#10b981', '#f59e0b', '#ef4444'];

export default function App() {
  const [auth, setAuth] = useState<{ token: string, role: string, username: string, vehicleId: string | null } | null>(
    JSON.parse(localStorage.getItem('fleet_auth') || 'null')
  );
  
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');

  const [activeTab, setActiveTab] = useState<'monitor' | 'devices' | 'parking'>('monitor');

  const [history, setHistory] = useState<any[]>([]);
  const [analytics, setAnalytics] = useState({ averageSpeed: 0, maxSpeed: 0, driverScore: 100, totalRecords: 0, estimatedFuel: 0 });
  const [parkingSpots, setParkingSpots] = useState<any[]>([]);
  const [geofenceAlerts, setGeofenceAlerts] = useState<string[]>([]);
  const previousZoneStatus = useRef<Record<string, boolean>>({});

  // State lưu cảnh báo SOS
  const [sosAlert, setSosAlert] = useState<{ vehicleId: string, time: string } | null>(null);

  const [devices, setDevices] = useState([
    { id: 'GW-TRUCK-01', name: 'Bộ định vị Xe 01', status: 'Online', battery: 92, rssi: -65, lastSeen: 'Vừa xong' },
    { id: 'GW-TRUCK-02', name: 'Bộ định vị Xe 02', status: 'Online', battery: 85, rssi: -58, lastSeen: 'Vừa xong' },
    { id: 'GW-TRUCK-03', name: 'Bộ định vị Xe 03', status: 'Offline', battery: 0, rssi: -110, lastSeen: '5 phút trước' },
  ]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await axios.post('https://iot-cloude.onrender.com/api/auth/login', { username, password });
      const userAuth = { token: res.data.token, role: res.data.role, username: res.data.username, vehicleId: res.data.vehicleId };
      localStorage.setItem('fleet_auth', JSON.stringify(userAuth));
      setAuth(userAuth);
      setLoginError('');
    } catch (err) { setLoginError('Tài khoản hoặc mật khẩu không đúng!'); }
  };

  const handleLogout = () => {
    localStorage.removeItem('fleet_auth');
    setAuth(null);
  };

  // ==============================================================
  // VÁ LỖI 1: THÊM encodeURIComponent ĐỂ URL KHÔNG BỊ GÃY KHI CÓ EMOJI
  // ==============================================================
  const handleUpdateStatus = async (status: string) => {
    if (!auth?.vehicleId) return;
    try {
      await axios.post(`https://iot-cloude.onrender.com/api/tracking/status?vehicleId=${encodeURIComponent(auth.vehicleId)}&status=${encodeURIComponent(status)}`, {}, {
        headers: { Authorization: `Bearer ${auth.token}` }
      });
      alert(`✅ Đã thông báo trạng thái: ${status}`);
    } catch (e) { console.error("Lỗi cập nhật CSDL"); }
  };

  const handleSOS = async () => {
    if (!auth?.vehicleId) return;
    try {
      await axios.post(`https://iot-cloude.onrender.com/api/tracking/sos?vehicleId=${encodeURIComponent(auth.vehicleId)}`, {}, {
        headers: { Authorization: `Bearer ${auth.token}` }
      });
      alert("🚨 Đã gửi báo động SOS!");
    } catch (e) { alert("Lỗi khi gửi báo động SOS"); }
  };

  const handleDeviceControl = async (id: string, command: string) => {
    if (!auth) return;
    try {
      await axios.post(`https://iot-cloude.onrender.com/api/device/control?vehicleId=${encodeURIComponent(id)}&command=${encodeURIComponent(command)}`, {}, {
        headers: { Authorization: `Bearer ${auth.token}` }
      });
    } catch (e) { alert("Lỗi kết nối bộ điều khiển IoT"); }
  };

  useEffect(() => {
    if (!auth) return;
    
    // ==============================================================
    // VÁ LỖI 2: KHAI BÁO BIẾN currentToken ĐỂ FIX LỖI TYPESCRIPT "'auth' is possibly 'null'"
    // ==============================================================
    const currentToken = auth.token; 
    const headers = { Authorization: `Bearer ${currentToken}` };

    const fetchData = async () => {
      try {
        const histRes = await axios.get('https://iot-cloude.onrender.com/api/tracking/history', { headers });
        setHistory(histRes.data);
        const parkRes = await axios.get('https://iot-cloude.onrender.com/api/parking', { headers });
        setParkingSpots(parkRes.data);
        if (auth.role === 'Admin') {
          const anlRes = await axios.get('https://iot-cloude.onrender.com/api/tracking/analytics', { headers });
          setAnalytics(anlRes.data);
        }
      } catch (e: any) { if (e.response?.status === 401) handleLogout(); }
    };

    fetchData();

    const connection = new signalR.HubConnectionBuilder()
      // Truyền currentToken vào thay vì auth.token để chiều lòng TypeScript
      .withUrl("https://iot-cloude.onrender.com/trackingHub", { accessTokenFactory: () => currentToken })
      .withAutomaticReconnect()
      .build();
      connection.serverTimeoutInMilliseconds = 120000; // 2 phút không thấy server mới tính là sập
connection.keepAliveIntervalInMilliseconds = 15000; // Cứ 15 giây gửi 1 gói tin Ping để giữ đường truyền luôn nóng

    connection.start().catch(err => console.error("SignalR Lỗi kết nối:", err));
    
    connection.on("ReceiveNewLog", (newLog) => {
      setHistory(prev => [newLog, ...prev]);
      setDevices(prev => prev.map(d => d.id === `GW-${newLog.vehicleId}` ? { ...d, status: 'Online', rssi: -50 - Math.floor(Math.random() * 20), lastSeen: 'Vừa xong' } : d));
    });

    connection.on("ReceiveSOS", (data) => {
      setSosAlert(data);
    });

    if (auth.role === 'Admin') { connection.on("UpdateAnalytics", (newAnl) => setAnalytics(newAnl)); }

    return () => { connection.stop(); };
  }, [auth]);

  const groupedData: Record<string, any[]> = history.reduce((acc, curr) => {
    if (!acc[curr.vehicleId]) acc[curr.vehicleId] = [];
    acc[curr.vehicleId].push(curr);
    return acc;
  }, {});
  const vehicleIds = Object.keys(groupedData);

  useEffect(() => {
    const newAlerts: string[] = [];
    vehicleIds.forEach(id => {
      const latestPoint = groupedData[id][0];
      if (!latestPoint) return;
      const currentlyInside = isInsideGeofence(latestPoint.latitude, latestPoint.longitude);
      const wasInside = previousZoneStatus.current[id];
      if (wasInside !== undefined && wasInside !== currentlyInside) {
        const action = currentlyInside ? '📥 VÀO KHU VỰC' : '📤 RỜI KHU VỰC';
        newAlerts.push(`[${new Date(latestPoint.timestamp).toLocaleTimeString()}] ${id} ${action} Tổng Kho Quận 1`);
      }
      previousZoneStatus.current[id] = currentlyInside;
    });
    if (newAlerts.length > 0) setGeofenceAlerts(prev => [...newAlerts, ...prev].slice(0, 8));
  }, [history]);

  const handleBookSpot = async (spotId: number) => {
    if (!auth?.vehicleId) return alert("Chỉ tài xế mới có quyền điều khiển bãi đỗ!");
    try {
      await axios.post(`https://iot-cloude.onrender.com/api/parking/book?vehicleId=${auth.vehicleId}&spotId=${spotId}`, {}, {
        headers: { Authorization: `Bearer ${auth.token}` }
      });
      alert(`✅ Đã đặt thành công bãi đỗ số ${spotId}!`);
      const parkRes = await axios.get('https://iot-cloude.onrender.com/api/parking', { headers: { Authorization: `Bearer ${auth.token}` } });
      setParkingSpots(parkRes.data);
    } catch (error: any) { alert("Lỗi gửi lệnh."); }
  };

  // ==============================================
  // GIAO DIỆN 1: LOGIN (LIGHT THEME)
  // ==============================================
  if (!auth) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#f1f5f9', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
        <div style={{ background: 'white', padding: '40px', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 10px 25px rgba(0,0,0,0.05)', width: '360px', color: '#1e293b' }}>
          <h2 style={{ textAlign: 'center', color: '#0ea5e9', letterSpacing: '1px', marginBottom: '5px' }}>🌐 OMNI LOGISTICS</h2>
          <p style={{ textAlign: 'center', color: '#64748b', marginBottom: '35px', fontSize: '13px' }}>Hệ thống quản lý và điều hành thông minh</p>
          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', color: '#475569', marginBottom: '5px', fontWeight: 'bold' }}>TÀI KHOẢN</label>
              <input type="text" placeholder="admin hoặc driver1" value={username} onChange={e => setUsername(e.target.value)} required style={{ width: '100%', boxSizing: 'border-box', padding: '12px', background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '6px', color: '#0f172a', outline: 'none' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12px', color: '#475569', marginBottom: '5px', fontWeight: 'bold' }}>MẬT KHẨU</label>
              <input type="password" placeholder="123" value={password} onChange={e => setPassword(e.target.value)} required style={{ width: '100%', boxSizing: 'border-box', padding: '12px', background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '6px', color: '#0f172a', outline: 'none' }} />
            </div>
            {loginError && <span style={{ color: '#ef4444', fontSize: '13px', textAlign: 'center' }}>❌ {loginError}</span>}
            <button type="submit" style={{ background: '#0ea5e9', color: 'white', padding: '14px', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer', fontSize: '14px', boxShadow: '0 4px 6px rgba(14, 165, 233, 0.2)' }}>ĐĂNG NHẬP</button>
          </form>
        </div>
      </div>
    );
  }

  const overSpeedingTrucks = vehicleIds.map(id => groupedData[id][0]).filter(t => t && t.speed > 60);
  const brokenColdChainTrucks = vehicleIds.map(id => groupedData[id][0]).filter(t => t && t.temperature > 8);
  const chartData = history.slice(0, 15).reverse().map(h => ({ time: new Date(h.timestamp).toLocaleTimeString(), Nhiệt_Độ: h.temperature, Tốc_Độ: h.speed }));

  // ==============================================
  // GIAO DIỆN 2: DASHBOARD (LIGHT THEME)
  // ==============================================
  return (
    <div style={{ backgroundColor: '#f1f5f9', minHeight: '100vh', color: '#0f172a', fontFamily: 'system-ui, -apple-system, sans-serif', padding: '0 0 20px 0' }}>
      
      {/* VÁ LỖI GIAO DIỆN SOS: HIỂN THỊ RESPONSIVE VÀ NÚT TẮT CẢNH BÁO CHO DRIVER */}
      {sosAlert && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(239, 68, 68, 0.95)', zIndex: 9999, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', color: 'white', padding: '20px', textAlign: 'center', boxSizing: 'border-box' }}>
          
          <h1 style={{ fontSize: 'clamp(30px, 6vw, 80px)', margin: '0 0 20px 0', textShadow: '0 0 20px #000', lineHeight: '1.2', animation: 'pulse 1s infinite' }}>🚨 SOS KHẨN CẤP 🚨</h1>
          
          <h2 style={{ fontSize: 'clamp(20px, 4vw, 40px)', margin: '0 0 10px 0' }}>
            TÀI XẾ XE <span style={{ color: '#fef08a' }}>{sosAlert.vehicleId}</span> YÊU CẦU TRỢ GIÚP!
          </h2>
          <p style={{ fontSize: 'clamp(16px, 2vw, 24px)', marginBottom: '40px' }}>Thời gian báo động: {sosAlert.time}</p>
          
          {auth.role === 'Admin' ? (
            <button onClick={() => setSosAlert(null)} style={{ padding: '15px 30px', background: 'white', color: '#b91c1c', border: 'none', borderRadius: '10px', fontSize: 'clamp(16px, 2vw, 24px)', fontWeight: 'bold', cursor: 'pointer', boxShadow: '0 10px 20px rgba(0,0,0,0.3)' }}>
              ĐÃ TIẾP NHẬN XỬ LÝ
            </button>
          ) : (
            <button onClick={() => setSosAlert(null)} style={{ padding: '15px 30px', background: '#fef08a', color: '#b91c1c', border: 'none', borderRadius: '10px', fontSize: 'clamp(14px, 2vw, 20px)', fontWeight: 'bold', cursor: 'pointer', boxShadow: '0 10px 20px rgba(0,0,0,0.3)' }}>
              ĐÃ GỬI TÍN HIỆU - QUAY LẠI MÀN HÌNH
            </button>
          )}
        </div>
      )}

      {/* THANH TOPBAR */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'white', padding: '15px 30px', borderBottom: '1px solid #e2e8f0', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '30px' }}>
          <h2 style={{ margin: 0, color: '#0ea5e9', letterSpacing: '1px', fontSize: '20px', fontWeight: '800' }}>🚀 OMNI LOGISTICS</h2>
          
          <div style={{ display: 'flex', gap: '10px' }}>
            <button onClick={() => setActiveTab('monitor')} style={{ background: activeTab === 'monitor' ? '#e0f2fe' : 'transparent', color: activeTab === 'monitor' ? '#0284c7' : '#64748b', border: 'none', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', transition: '0.2s' }}>📊 Giám Sát</button>
            {auth.role === 'Admin' && (
              <button onClick={() => setActiveTab('devices')} style={{ background: activeTab === 'devices' ? '#f3e8ff' : 'transparent', color: activeTab === 'devices' ? '#7e22ce' : '#64748b', border: 'none', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', transition: '0.2s' }}>🎛️ Thiết Bị</button>
            )}
            <button onClick={() => setActiveTab('parking')} style={{ background: activeTab === 'parking' ? '#fef3c7' : 'transparent', color: activeTab === 'parking' ? '#d97706' : '#64748b', border: 'none', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', transition: '0.2s' }}>🅿️ Bãi Đỗ Xe</button>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <div style={{ textAlign: 'right' }}>
            <span style={{ fontSize: '11px', color: '#64748b', display: 'block', fontWeight: 'bold' }}>XIN CHÀO</span>
            <strong style={{ color: '#0f172a' }}>{auth.username.toUpperCase()} ({auth.role})</strong>
          </div>
          <button onClick={handleLogout} style={{ background: '#ef4444', color: 'white', border: 'none', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold', boxShadow: '0 2px 4px rgba(239, 68, 68, 0.2)' }}>Đăng xuất</button>
        </div>
      </div>

      <div style={{ padding: '20px 30px' }}>
        
        {/* THANH ĐIỀU KHIỂN RIÊNG CHO TÀI XẾ (SOS + TRẠNG THÁI) */}
        {auth.role === 'Driver' && (
          <div style={{ background: 'white', padding: '15px 20px', borderRadius: '10px', marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 4px 6px rgba(0,0,0,0.05)', border: '1px solid #e2e8f0' }}>
             <button onClick={handleSOS} style={{ background: '#ef4444', color: 'white', border: 'none', padding: '10px 25px', borderRadius: '8px', cursor: 'pointer', fontSize: '16px', fontWeight: 'bold', boxShadow: '0 4px 10px rgba(239, 68, 68, 0.3)', animation: 'pulse 2s infinite' }}>🚨 BÁO ĐỘNG SỰ CỐ TẬN NƠI (SOS)</button>
             
             <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <span style={{ fontWeight: 'bold', color: '#64748b', marginRight: '10px' }}>CẬP NHẬT TIẾN ĐỘ:</span>
                {['📦 Đang bốc hàng', '🚚 Đang di chuyển', '🛑 Nghỉ ngơi / Đổ xăng', '✅ Giao thành công'].map(s => (
                  <button 
                    key={s} 
                    onClick={() => {
                      handleUpdateStatus(s); 
                      handleDeviceControl(auth.vehicleId!, `STATUS_${s}`); 
                    }} 
                    style={{ padding: '10px 15px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#f8fafc', cursor: 'pointer', fontWeight: 'bold', color: '#0f172a', transition: '0.2s' }}>
                    {s}
                  </button>
                ))}
             </div>
          </div>
        )}

        {/* BANNER CẢNH BÁO ADMIN */}
        {auth.role === 'Admin' && (
          <>
            {overSpeedingTrucks.length > 0 && <div style={{ background: '#fee2e2', border: '1px solid #f87171', color: '#b91c1c', padding: '12px 20px', borderRadius: '8px', marginBottom: '15px', fontWeight: 'bold', boxShadow: '0 2px 4px rgba(248, 113, 113, 0.1)' }}>🚨 CẢNH BÁO: Phát hiện {overSpeedingTrucks.length} phương tiện vượt quá tốc độ 60km/h ({overSpeedingTrucks.map(t=>t.vehicleId).join(', ')})!</div>}
            {brokenColdChainTrucks.length > 0 && <div style={{ background: '#ffedd5', border: '1px solid #fb923c', color: '#c2410c', padding: '12px 20px', borderRadius: '8px', marginBottom: '15px', fontWeight: 'bold', boxShadow: '0 2px 4px rgba(251, 146, 60, 0.1)' }}>❄️ SỰ CỐ CHUỖI LẠNH: Lô hàng trên {brokenColdChainTrucks.length} xe đang gặp nguy hiểm (Nhiệt độ &gt; 8°C)!</div>}
          </>
        )}

        {/* ======================= TAB 1: MONITOR ======================= */}
        {activeTab === 'monitor' && (
          <>
            {auth.role === 'Admin' ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '20px', marginBottom: '20px' }}>
                {[
                  { label: 'Điểm an toàn', val: `${analytics.driverScore}%`, color: '#10b981', alert: analytics.driverScore < 80 },
                  { label: 'Nhiên liệu tiêu thụ', val: `${analytics.estimatedFuel} L`, color: '#f59e0b', alert: false },
                  { label: 'Tốc độ trung bình', val: `${analytics.averageSpeed} km/h`, color: '#0ea5e9', alert: false },
                  { label: 'Tốc độ tối đa', val: `${analytics.maxSpeed} km/h`, color: '#ef4444', alert: analytics.maxSpeed > 60 },
                  { label: 'Tổng bản ghi IoT', val: analytics.totalRecords, color: '#8b5cf6', alert: false }
                ].map((c, i) => (
                  <div key={i} style={{ background: 'white', padding: '20px', borderRadius: '10px', borderLeft: `5px solid ${c.color}`, boxShadow: '0 4px 6px rgba(0,0,0,0.05)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 'bold' }}>{c.label.toUpperCase()}</span>
                      <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: c.alert ? '#ef4444' : '#10b981' }}></span>
                    </div>
                    <h2 style={{ margin: '10px 0 0 0', color: '#0f172a', fontSize: '26px' }}>{c.val}</h2>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ background: '#ecfdf5', padding: '15px', borderRadius: '8px', marginBottom: '20px', border: '1px solid #10b981', color: '#047857', fontWeight: 'bold' }}>
                ℹ️ Chế độ Tài xế: Hệ thống radar tự động khóa vùng giám sát vào phương tiện <strong>{auth.vehicleId}</strong>.
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '20px' }}>
              {/* BẢN ĐỒ */}
              <div style={{ height: '520px', background: 'white', borderRadius: '10px', padding: '10px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px rgba(0,0,0,0.05)' }}>
                <MapContainer center={[10.79, 106.68]} zoom={13} style={{ height: '100%', borderRadius: '6px' }}>
                  <TileLayer url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png" attribution="CartoDB Light" />
                  <Rectangle bounds={GEOFENCE_BOUNDS} pathOptions={{ color: '#8b5cf6', fillColor: '#8b5cf6', fillOpacity: 0.1 }}><Popup>Khu vực kiểm soát (Geofence)</Popup></Rectangle>

                  {vehicleIds.map((id, index) => {
                    if (auth.role === 'Driver' && id !== auth.vehicleId) return null;
                    const path = groupedData[id];
                    const latest = path[0];
                    if (!latest) return null;

                    let currentIcon = DefaultIcon;
                    if (latest.speed > 60) currentIcon = AlertSpeedIcon;
                    if (latest.temperature > 8) currentIcon = AlertTempIcon;

                    return (
                      <div key={id}>
                        <Marker position={[latest.latitude, latest.longitude]} icon={currentIcon}>
                          <Popup>
                            <div style={{ color: '#0f172a' }}>
                              <strong style={{ fontSize: '15px', color: '#0ea5e9' }}>{id}</strong><br/><br/>
                              
                              🛠️ Trạng thái: <strong style={{ color: '#d97706' }}>{latest.status || latest.Status || '🚚 Đang di chuyển'}</strong><br/>
                              
                              🚚 Tốc độ: <strong style={{ color: latest.speed === 0 ? 'red' : 'green'}}>{latest.speed} km/h</strong><br/>
                              ❄️ Nhiệt độ: <strong>{latest.temperature}°C</strong>
                            </div>
                          </Popup>
                        </Marker>
                        <Polyline positions={path.map(p => [p.latitude, p.longitude]) as any} color={PIE_COLORS[index % PIE_COLORS.length]} weight={5} />
                      </div>
                    );
                  })}

                  {/* VẼ BÃI ĐỖ XE */}
                  {parkingSpots.map((spot) => (
                    <Marker key={spot.id} position={[spot.latitude, spot.longitude]} icon={ParkingIcon}>
                      <Popup>
                        <div style={{ textAlign: 'center', color: '#0f172a' }}>
                          <h4 style={{ margin: '0 0 8px 0' }}>{spot.name}</h4>
                          {spot.isAvailable ? (
                            auth.role === 'Driver' ? (
                              <button onClick={() => handleBookSpot(spot.id)} style={{ background: '#10b981', color: 'white', border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>Đặt Chỗ</button>
                            ) : <span style={{ color: '#10b981', fontWeight: 'bold' }}>Trống</span>
                          ) : (
                            <span style={{ color: '#ef4444', fontSize: '13px', fontWeight: 'bold' }}>Đã đặt bởi:<br/> {spot.bookedByVehicleId}</span>
                          )}
                        </div>
                      </Popup>
                    </Marker>
                  ))}
                </MapContainer>
              </div>

              {/* LOG GEOFENCE & BIỂU ĐỒ */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <div style={{ background: 'white', padding: '20px', borderRadius: '10px', border: '1px solid #e2e8f0', flexGrow: 1, overflowY: 'auto', height: '220px', boxShadow: '0 4px 6px rgba(0,0,0,0.05)' }}>
                  <h3 style={{ margin: '0 0 12px 0', color: '#8b5cf6', fontSize: '14px', borderBottom: '2px solid #f1f5f9', paddingBottom: '10px' }}>📍 NHẬT KÝ RA VÀO KHO</h3>
                  {geofenceAlerts.length === 0 ? (
                    <p style={{ color: '#94a3b8', fontSize: '13px', fontStyle: 'italic' }}>Chưa có phương tiện nào di chuyển qua cổng...</p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '12px' }}>
                      {geofenceAlerts.map((alert, idx) => (
                        <div key={idx} style={{ padding: '8px', background: '#f8fafc', borderRadius: '6px', borderLeft: `4px solid ${alert.includes('VÀO') ? '#10b981' : '#f59e0b'}`, color: '#334155', fontWeight: '500' }}>{alert}</div>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ background: 'white', padding: '20px', borderRadius: '10px', border: '1px solid #e2e8f0', height: '220px', boxShadow: '0 4px 6px rgba(0,0,0,0.05)' }}>
                  <h4 style={{ margin: '0 0 10px 0', fontSize: '13px', color: '#64748b' }}>📈 BIẾN THIÊN NHIỆT ĐỘ THỜI GIAN THỰC</h4>
                  <ResponsiveContainer width="100%" height={170}>
                    <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
                      <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#64748b' }} stroke="#cbd5e1" />
                      <YAxis tick={{ fontSize: 10, fill: '#64748b' }} stroke="#cbd5e1" />
                      <RechartsTooltip contentStyle={{ background: 'white', border: '1px solid #cbd5e1', color: '#0f172a', fontSize: '12px', borderRadius: '6px', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }} />
                      <Area type="monotone" dataKey="Nhiệt_Độ" stroke="#f59e0b" fill="rgba(245, 158, 11, 0.15)" strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </>
        )}

        {/* ======================= TAB 2: DEVICES ======================= */}
        {activeTab === 'devices' && (
          <div style={{ background: 'white', padding: '30px', borderRadius: '10px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px rgba(0,0,0,0.05)' }}>
            <h3 style={{ marginTop: 0, color: '#7e22ce' }}>🎛️ QUẢN LÝ THIẾT BỊ & PHẦN CỨNG IOT</h3>
            <p style={{ color: '#64748b', fontSize: '14px', marginTop: '-10px', marginBottom: '25px' }}>Giám sát trạng thái phần cứng và điều khiển máy lạnh AC từ xa qua giao thức MQTT.</p>
            
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #cbd5e1', color: '#475569' }}>
                  <th style={{ padding: '15px 10px' }}>MÃ THIẾT BỊ</th>
                  <th>TÊN PHẦN CỨNG</th>
                  <th>TRẠNG THÁI</th>
                  <th>PIN</th>
                  <th>SÓNG (RSSI)</th>
                  <th>HÀNH ĐỘNG HẠ TẦNG</th>
                </tr>
              </thead>
              <tbody>
                {devices.map((dev, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #e2e8f0', background: i % 2 === 0 ? '#f8fafc' : 'white' }}>
                    <td style={{ padding: '15px 10px', color: '#0ea5e9', fontWeight: 'bold' }}>{dev.id}</td>
                    <td style={{ color: '#334155' }}>{dev.name}</td>
                    <td>
                      <span style={{ padding: '4px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: 'bold', background: dev.status === 'Online' ? '#d1fae5' : '#fee2e2', color: dev.status === 'Online' ? '#059669' : '#b91c1c' }}>● {dev.status}</span>
                    </td>
                    <td style={{ color: '#334155' }}>{dev.status === 'Online' ? `${dev.battery}%` : 'N/A'}</td>
                    <td style={{ color: dev.rssi > -70 ? '#10b981' : '#f59e0b', fontWeight: 'bold' }}>{dev.rssi} dBm</td>
                    <td>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button onClick={() => handleDeviceControl(dev.id.replace('GW-', ''), 'AC_ON')} style={{ background: '#0ea5e9', color: 'white', border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}>❄️ BẬT AC</button>
                        <button onClick={() => handleDeviceControl(dev.id.replace('GW-', ''), 'AC_OFF')} style={{ background: '#ef4444', color: 'white', border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}>🔥 TẮT AC</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ======================= TAB 3: PARKING ======================= */}
        {activeTab === 'parking' && (
          <div style={{ background: 'white', padding: '30px', borderRadius: '10px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px rgba(0,0,0,0.05)' }}>
            <h3 style={{ marginTop: 0, color: '#d97706' }}>🅿️ HỆ THỐNG ĐIỀU PHỐI BÃI ĐỖ XE</h3>
            <p style={{ color: '#64748b', fontSize: '14px', marginTop: '-10px', marginBottom: '25px' }}>Quản lý và đặt chỗ các bãi đỗ xe thông minh trên toàn thành phố.</p>
            
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '25px' }}>
              {parkingSpots.map((spot) => (
                <div key={spot.id} style={{ background: '#f8fafc', padding: '25px', borderRadius: '12px', border: spot.isAvailable ? '1px solid #10b981' : '1px solid #ef4444', textAlign: 'center', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
                  <div style={{ fontSize: '36px', marginBottom: '15px' }}>🅿️</div>
                  <h4 style={{ margin: '0 0 8px 0', color: '#0f172a', fontSize: '18px' }}>{spot.name}</h4>
                  <p style={{ fontSize: '12px', color: '#64748b', margin: '0 0 20px 0' }}>Tọa độ GPS: {spot.latitude}, {spot.longitude}</p>
                  
                  {spot.isAvailable ? (
                    <div>
                      <div style={{ color: '#10b981', fontSize: '13px', fontWeight: 'bold', marginBottom: '15px' }}>🟢 SẴN SÀNG CHO THUÊ</div>
                      <button onClick={() => handleBookSpot(spot.id)} style={{ width: '100%', background: '#10b981', color: 'white', border: 'none', padding: '12px', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer', boxShadow: '0 4px 6px rgba(16, 185, 129, 0.2)' }}>Gửi lệnh đặt bãi</button>
                    </div>
                  ) : (
                    <div>
                      <div style={{ color: '#ef4444', fontSize: '13px', fontWeight: 'bold', marginBottom: '15px' }}>🔴 ĐÃ CÓ XE ĐẶT CHỖ</div>
                      <div style={{ padding: '10px', background: '#fee2e2', color: '#b91c1c', borderRadius: '6px', fontSize: '13px', fontWeight: 'bold', border: '1px solid #fca5a5' }}>Biển số xe: {spot.bookedByVehicleId}</div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}