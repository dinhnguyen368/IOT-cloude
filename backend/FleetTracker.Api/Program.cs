using FleetTracker.Api.Services;
using FleetTracker.Data; 
using Microsoft.EntityFrameworkCore; 
using FleetTracker.Core;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

// 1. ĐỌC CẤU HÌNH TỪ APPSETTINGS.JSON
var connectionString = builder.Configuration.GetConnectionString("DefaultConnection");

// 2. KẾT NỐI DATABASE BẰNG POSTGRESQL (Thay cho SQLite)
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseNpgsql(connectionString));
    
// 3. ĐĂNG KÝ MQTT SERVICE CHẠY NGẦM
builder.Services.AddHostedService<MqttHostedService>();
builder.Services.AddCors(options => {
    options.AddPolicy("AllowReactApp",
        policy => policy.AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader());
});
var app = builder.Build();
app.UseCors("AllowReactApp");
// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseHttpsRedirection();


// (Phần thời tiết mặc định của .NET - cứ giữ lại demo cũng không sao)
var summaries = new[]
{
    "Freezing", "Bracing", "Chilly", "Cool", "Mild", "Warm", "Balmy", "Hot", "Sweltering", "Scorching"
};

// --- API MỚI CHO REACT ---

// API 1: Lấy danh sách 100 tọa độ mới nhất để vẽ bản đồ
app.MapGet("/api/tracking/history", async (AppDbContext db) =>
{
    var history = await db.TrackingLogs
        .OrderByDescending(t => t.Timestamp)
        .Take(100)
        .ToListAsync();
    return Results.Ok(history);
})
.WithName("GetTrackingHistory")
.WithOpenApi();

// API 2: Lấy thông số tốc độ trung bình và max speed để vẽ biểu đồ Analytics
// API Phân tích nâng cao (Có tính toán nhiên liệu)
app.MapGet("/api/tracking/analytics", async (AppDbContext db) =>
{
    var logs = await db.TrackingLogs.ToListAsync();
    if (!logs.Any()) return Results.Ok(new { AverageSpeed = 0, MaxSpeed = 0, DriverScore = 100, TotalRecords = 0, EstimatedFuel = 0 });

    var totalRecords = logs.Count;
    var avgSpeed = logs.Average(l => l.Speed);
    var maxSpeed = logs.Max(l => l.Speed);
    
    // 1. Tính điểm tài xế: 100 điểm - (số lần vi phạm > 60km/h * 5 điểm)
    var speedingCount = logs.Count(l => l.Speed > 60);
    var driverScore = Math.Max(0, 100 - (speedingCount * 5));

    // 2. Ước tính nhiên liệu: 
    // Giả sử mỗi bản ghi cách nhau 3 giây. Quãng đường = Vận tốc * Thời gian
    // Mức tiêu thụ trung bình của xe tải: 20 lít / 100km (Tương đương 0.2 lít / 1 km)
    var totalDistanceKm = logs.Sum(l => l.Speed * (3.0 / 3600.0));
    var estimatedFuel = totalDistanceKm * 0.2;

    return Results.Ok(new { 
        AverageSpeed = Math.Round(avgSpeed, 1), 
        MaxSpeed = maxSpeed, 
        DriverScore = driverScore,
        TotalRecords = totalRecords,
        EstimatedFuel = Math.Round(estimatedFuel, 2) // Trả về số lít nhiên liệu
    });
})
.WithName("GetTrackingAnalytics")
.WithOpenApi();
// --- API CHO TÍNH NĂNG ĐẶT BÃI ĐỖ XE ---

// 1. API Lấy danh sách bãi đỗ xe
app.MapGet("/api/parking", async (AppDbContext db) =>
{
    var spots = await db.ParkingSpots.ToListAsync();
    return Results.Ok(spots);
})
.WithName("GetParkingSpots")
.WithOpenApi();

// 2. API Tài xế đặt chỗ
app.MapPost("/api/parking/book", async (string vehicleId, int spotId, AppDbContext db) =>
{
    var spot = await db.ParkingSpots.FindAsync(spotId);
    if (spot == null) return Results.NotFound("Không tìm thấy bãi đỗ xe.");
    if (!spot.IsAvailable) return Results.BadRequest("Bãi đỗ xe này đã có người đặt.");

    // Cập nhật trạng thái bãi đỗ
    spot.IsAvailable = false;
    spot.BookedByVehicleId = vehicleId;
    await db.SaveChangesAsync();

    return Results.Ok(new { Message = $"Xe {vehicleId} đã đặt thành công bãi {spot.Name}!" });
})
.WithName("BookParkingSpot")
.WithOpenApi();
// --- TỰ ĐỘNG TẠO 3 BÃI ĐỖ XE MẶC ĐỊNH NẾU DATABASE TRỐNG ---
using (var scope = app.Services.CreateScope())
{
    var dbContext = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    if (!dbContext.ParkingSpots.Any())
    {
        dbContext.ParkingSpots.AddRange(
            new ParkingSpot { Name = "Bãi đỗ xe Tân Bình", Latitude = 10.7950, Longitude = 106.6600, IsAvailable = true },
            new ParkingSpot { Name = "Bãi đỗ xe Quận 1", Latitude = 10.7750, Longitude = 106.7000, IsAvailable = true },
            new ParkingSpot { Name = "Bãi đỗ xe Thủ Đức", Latitude = 10.8500, Longitude = 106.7500, IsAvailable = true }
        );
        dbContext.SaveChanges();
    }
}

app.Run(); // (Đây là dòng dưới cùng của file)
app.Run();

record WeatherForecast(DateOnly Date, int TemperatureC, string? Summary)
{
    public int TemperatureF => 32 + (int)(TemperatureC / 0.5556);
}