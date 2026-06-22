import paho.mqtt.client as mqtt
import time
import json
import random
from datetime import datetime, timezone

BROKER = "localhost"
PORT = 1883
TOPIC = "logistics/fleet/truck_hcm_01" 

trucks = [
    {
        "id": "TRUCK_HCM_01", 
        "route": [(10.7769, 106.7009), (10.7795, 106.6875), (10.7850, 106.6780), (10.7928, 106.6710)],
        "speed_range": (30, 50),
        "temp_range": (2.0, 5.0), # Nhiệt độ chuẩn (2-5 độ C)
        "index": 0
    },
    {
        "id": "TRUCK_HCM_02", 
        "route": [(10.8105, 106.6645), (10.8200, 106.6500), (10.8300, 106.6400), (10.8400, 106.6300)],
        "speed_range": (55, 75), # Xe hay chạy quá tốc độ
        "temp_range": (2.0, 5.0), # Nhiệt độ chuẩn
        "index": 0
    },
    {
        "id": "TRUCK_HCM_03", 
        "route": [(10.7500, 106.6800), (10.7550, 106.6850), (10.7600, 106.6900), (10.7650, 106.6950)],
        "speed_range": (20, 40),
        "temp_range": (7.0, 10.0), # CỐ TÌNH LÀM HỎNG MÁY LẠNH (> 8 độ C)
        "index": 0
    }
]

client = mqtt.Client(client_id="Multi_Fleet_Simulator")
client.connect(BROKER, PORT, 60)
client.loop_start()

try:
    print("Bắt đầu giả lập Đội xe đông lạnh...")
    while True:
        for truck in trucks:
            lat, lng = truck["route"][truck["index"] % len(truck["route"])]
            speed = round(random.uniform(*truck["speed_range"]), 1)
            
            # Giả lập thêm Nhiệt độ và Độ ẩm
            temp = round(random.uniform(*truck["temp_range"]), 1)
            humidity = round(random.uniform(70, 85), 1)
            
            payload = {
                "vehicleId": truck["id"],
                "latitude": lat,
                "longitude": lng,
                "speed": speed,
                "temperature": temp,  # <-- THÊM MỚI
                "humidity": humidity, # <-- THÊM MỚI
                "timestamp": datetime.now(timezone.utc).isoformat()
            }
            
            client.publish(TOPIC, json.dumps(payload))
            print(f"Gửi: {truck['id']} | Tốc độ: {speed}km/h | Nhiệt độ: {temp}°C")
            truck["index"] += 1
            
        print("-" * 40)
        time.sleep(3)

except KeyboardInterrupt:
    client.loop_stop()
    client.disconnect()