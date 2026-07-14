import pyshark
import time

def capture_mqtt_traffic(duration=10):
    print(f"[*] Đang khởi động bộ giám sát mạng (Wireshark Engine)...")
    print(f"[*] Bắt đầu thu thập gói tin MQTT (Port 1883) trong {duration} giây...")
    
    # Kết nối vào card mạng nội bộ
    capture = pyshark.LiveCapture(interface='Wi-Fi', bpf_filter='tcp port 1883',output_file='luu_luong_demo.pcapng')
    
    packet_count = [0] # Dùng mảng để lưu số lượng gói tin

    # Hàm này sẽ được gọi ngay lập tức mỗi khi bắt được 1 gói tin
    def process_packet(packet):
        packet_count[0] += 1
        print(f"[+] Bắt được gói tin #{packet_count[0]}: {packet.highest_layer} | Độ dài: {packet.length} bytes")

    try:
        # Bắt đầu nghe lén, sẽ TỰ ĐỘNG NGẮT khi hết 'duration' giây
        capture.apply_on_packets(process_packet, timeout=duration)
    except TimeoutError:
        # Hết 10 giây nó sẽ nhảy vào đây một cách êm đẹp, không báo lỗi
        pass
    except Exception as e:
        print(f"[!] Có lỗi xảy ra: {e}")
        
    print("-" * 50)
    print("BÁO CÁO PHÂN TÍCH MẠNG TÓM TẮT:")
    print(f"- Thời gian đo: {duration} giây")
    print(f"- Tổng số gói tin MQTT bắt được: {packet_count[0]}")
    if duration > 0:
        print(f"- Tần suất: {packet_count[0] / duration:.2f} gói tin/giây")
    print("-" * 50)

if __name__ == "__main__":
    # CHÚ Ý: Nhớ bật file iot_sensor.py trước khi chạy file này nhé!
    capture_mqtt_traffic(duration=10)