namespace FleetTracker.Core;

public class TrackingLog
{
    public int Id { get; set; }
    public string VehicleId { get; set; } = string.Empty;
    public double Latitude { get; set; }
    public double Longitude { get; set; }
    public double Speed { get; set; }
    
    // --- THÊM 2 DÒNG NÀY CHO CHUỖI CUNG ỨNG LẠNH ---
    public double Temperature { get; set; } 
    public double Humidity { get; set; }    
    
    public DateTime Timestamp { get; set; }
}