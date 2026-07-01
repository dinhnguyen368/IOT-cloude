namespace FleetTracker.Core;

public class TrackingLog
{
    public int Id { get; set; }
    public string VehicleId { get; set; } = string.Empty;
    public double Latitude { get; set; }
    public double Longitude { get; set; }
    public double Speed { get; set; }
    
    // --- CẢM BIẾN CHUỖI CUNG ỨNG LẠNH ---
    public double Temperature { get; set; } 
    public double Humidity { get; set; }    
    
    // --- BẮT BUỘC PHẢI CÓ DÒNG NÀY ĐỂ HỨNG TRẠNG THÁI ---
    public string Status { get; set; } = "🚚 Đang di chuyển";
    
    public DateTime Timestamp { get; set; }
}