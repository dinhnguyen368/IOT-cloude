import paho.mqtt.client as mqtt
import time
import json
import random
from datetime import datetime, timezone

# Trỏ về localhost để test ép tải an toàn và Wireshark Loopback bắt được 100%
BROKER = "broker.emqx.io"
PORT = 1883
TOPIC = "logistics/fleet/truck_hcm_01"

# --- BIẾN TRẠNG THÁI ---
ac_status = {}
truck_status = {}
trucks = []

# --- TỰ ĐỘNG TẠO 500 CHIẾC XE TẢI GIẢ LẬP ---
for i in range(1, 501):
    truck_id = f"TRUCK_HCM_{i:03d}"
    
    trucks.append({
        "id": truck_id, 
        # Tọa độ khởi tạo ngẫu nhiên xung quanh khu vực TP.HCM
        "current_lat": 10.7769 + random.uniform(-0.1, 0.1), 
        "current_lng": 106.7009 + random.uniform(-0.1, 0.1), 
        # Bước nhảy tọa độ (hướng đi) ngẫu nhiên
        "lat_step": random.uniform(-0.0002, 0.0002), 
        "lng_step": random.uniform(-0.0002, 0.0002), 
        # Dải tốc độ ngẫu nhiên
        "speed_range": (30, 60)
    })
    
    # Cấp trạng thái mặc định cho toàn bộ 500 xe
    truck_status[truck_id] = "🚚 Đang di chuyển"
    ac_status[truck_id] = True

# --- LẮNG NGHE LỆNH TỪ WEB (MQTT) ---
def on_message(client, userdata, msg):
    payload = msg.payload.decode('utf-8')
    print(f"\n[LỆNH TỪ SERVER]: {payload}")
    try:
        vehicle_id, command = payload.split('|')
        
        if vehicle_id in ac_status:
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

client = mqtt.Client(client_id="Multi_Fleet_Simulator_StressTest")
client.on_message = on_message
client.connect(BROKER, PORT, 60)
client.subscribe("logistics/control")
client.loop_start()

try:
    print(f"🚀 HỆ THỐNG IOT ĐÃ KHỞI ĐỘNG - SẴN SÀNG ÉP TẢI VỚI {len(trucks)} THIẾT BỊ...")
    while True:
        for truck in trucks:
            current_status = truck_status[truck["id"]]
            
            # KIỂM TRA ĐIỀU KIỆN DI CHUYỂN
            is_moving = "di chuyển" in current_status.lower()
            
            if is_moving:
                # Cập nhật tịnh tiến tọa độ
                truck["current_lat"] += truck["lat_step"] + random.uniform(-0.00002, 0.00002)
                truck["current_lng"] += truck["lng_step"] + random.uniform(-0.00002, 0.00002)
                speed = round(random.uniform(*truck["speed_range"]), 1)
            else:
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
            
            # In log rút gọn để Terminal không bị lag quá mức khi in 500 dòng/giây
            moving_icon = "🏃" if is_moving else "🛑"
            print(f"[GỬI] {truck['id']} | {moving_icon} | {speed}km/h | {truck['current_lat']:.4f}, {truck['current_lng']:.4f}")
            
        print(f"[{datetime.now().strftime('%H:%M:%S')}] Đã đẩy xong 1 batch {len(trucks)} xe tải lên máy chủ.")
        print("=" * 60)
        
        # Thời gian ngủ rút ngắn xuống 1 giây để tăng tối đa lượng request (Tạo áp lực hệ thống)
        time.sleep(1)

except KeyboardInterrupt:
    client.loop_stop()
    client.disconnect()
    print("Đã ngắt giả lập.")