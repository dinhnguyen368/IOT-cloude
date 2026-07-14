import paho.mqtt.client as mqtt
import time
import json
import random
from datetime import datetime, timezone

BROKER = "broker.emqx.io" 
PORT = 1883
TOPIC = "logistics/fleet/truck_hcm_01"
# --- BIẾN TRẠNG THÁI ---
ac_status = { "TRUCK_HCM_01": True, "TRUCK_HCM_02": True, "TRUCK_HCM_03": False }

# Mặc định tất cả các xe đều đang di chuyển ban đầu
truck_status = { 
    "TRUCK_HCM_01": "🚚 Đang di chuyển", 
    "TRUCK_HCM_02": "🚚 Đang di chuyển", 
    "TRUCK_HCM_03": "🚚 Đang di chuyển" 
}

# --- LẮNG NGHE LỆNH TỪ WEB (MQTT) ---
def on_message(client, userdata, msg):
    payload = msg.payload.decode('utf-8')
    print(f"\n[LỆNH TỪ SERVER]: {payload}")
    try:
        vehicle_id, command = payload.split('|')
        
        # Xử lý lệnh Máy lạnh
        if command == 'AC_ON': 
            ac_status[vehicle_id] = True
        elif command == 'AC_OFF': 
            ac_status[vehicle_id] = False
            
        # Xử lý lệnh Trạng thái (Workflow)
        elif command.startswith('STATUS_'): 
            new_status = command.split('_')[1]
            truck_status[vehicle_id] = new_status
            print(f"🛑 [ĐIỀU KHIỂN] Xe {vehicle_id} chuyển trạng thái thành: {new_status}")
            
    except Exception as e:
        pass

client = mqtt.Client(client_id="Multi_Fleet_Simulator")
client.on_message = on_message
client.connect(BROKER, PORT, 60)
client.subscribe("logistics/control")
client.loop_start()

# --- CẤU HÌNH ĐỘI XE VỚI THUẬT TOÁN VECTOR ---
trucks = [
    {
        "id": "TRUCK_HCM_01", 
        "current_lat": 10.7769, "current_lng": 106.7009, 
        "lat_step": 0.00015, "lng_step": -0.00010, 
        "speed_range": (30, 50)
    },
    {
        "id": "TRUCK_HCM_02", 
        "current_lat": 10.8105, "current_lng": 106.6645, 
        "lat_step": -0.00020, "lng_step": 0.00005, 
        "speed_range": (55, 75)
    },
    {
        "id": "TRUCK_HCM_03", 
        "current_lat": 10.7500, "current_lng": 106.6800, 
        "lat_step": 0.00010, "lng_step": 0.00015,  
        "speed_range": (20, 40)
    }
]

try:
    print("🚀 HỆ THỐNG IOT ĐÃ KHỞI ĐỘNG - SẴN SÀNG NHẬN LỆNH DỪNG/CHẠY TỪ TÀI XẾ...")
    while True:
        for truck in trucks:
            current_status = truck_status[truck["id"]]
            
            # KIỂM TRA ĐIỀU KIỆN DI CHUYỂN
            # Nếu trong chuỗi trạng thái có chữ "di chuyển" -> Cho phép xe chạy
            is_moving = "di chuyển" in current_status.lower()
            
            if is_moving:
                # Cập nhật tịnh tiến tọa độ
                truck["current_lat"] += truck["lat_step"] + random.uniform(-0.00002, 0.00002)
                truck["current_lng"] += truck["lng_step"] + random.uniform(-0.00002, 0.00002)
                # Xe đang chạy -> random tốc độ
                speed = round(random.uniform(*truck["speed_range"]), 1)
            else:
                # XE DỪNG LẠI (Đang bốc hàng, nghỉ ngơi, giao xong)
                # Không cập nhật tọa độ -> Xe đứng im trên map
                speed = 0.0 # Ép tốc độ về 0 km/h
            
            humidity = round(random.uniform(70, 85), 1)
            
            # Xử lý nhiệt độ (dựa vào máy lạnh)
            if ac_status[truck["id"]]: 
                temp = round(random.uniform(2.0, 5.0), 1)
            else: 
                temp = round(random.uniform(8.0, 15.0), 1)
            
            # ĐÓNG GÓI PAYLOAD 
            payload = {
                "VehicleId": truck["id"],
                "Latitude": truck["current_lat"],
                "Longitude": truck["current_lng"],
                "Speed": speed,
                "Temperature": temp, 
                "Humidity": humidity, 
                "Status": current_status,
                "Timestamp": datetime.now(timezone.utc).isoformat()
            }
            
            client.publish(TOPIC, json.dumps(payload))
            
            # Hiển thị log ra terminal để dễ theo dõi
            moving_icon = "🏃 ĐANG CHẠY" if is_moving else "🛑 ĐANG DỪNG"
            print(f"[GỬI] {truck['id']} | {moving_icon} | Tốc độ: {speed}km/h | Tọa độ: {truck['current_lat']:.4f}, {truck['current_lng']:.4f} | Status: {current_status}")
            
        print("-" * 50)
        time.sleep(3)

except KeyboardInterrupt:
    client.loop_stop()
    client.disconnect()
    print("Đã ngắt giả lập.")