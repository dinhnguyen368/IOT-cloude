namespace FleetTracker.Core;

public class User
{
    public int Id { get; set; }
    public string Username { get; set; } = string.Empty;
    public string Password { get; set; } = string.Empty; // Lưu nháp không mã hóa cho bản Demo MVP
    public string Role { get; set; } = string.Empty; // Sẽ có 2 loại: "Admin" hoặc "Driver"
    
    // Nếu là Tài xế, họ sẽ được gắn cứng với 1 chiếc xe
    public string? AssignedVehicleId { get; set; } 
}