namespace FleetTracker.Core;

public class ParkingSpot
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty; // Tên bãi đỗ (VD: Bãi đỗ Tân Bình)
    public double Latitude { get; set; }
    public double Longitude { get; set; }
    public bool IsAvailable { get; set; } = true; // Còn trống không?
    public string? BookedByVehicleId { get; set; } // Xe nào đang đặt chỗ?
}