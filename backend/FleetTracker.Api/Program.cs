using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using FleetTracker.Api.Hubs;
using FleetTracker.Api.Services;
using FleetTracker.Core;
using FleetTracker.Data;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

// Cấu hình Database & MQTT
var connectionString = builder.Configuration.GetConnectionString("DefaultConnection");
builder.Services.AddDbContext<AppDbContext>(options => options.UseNpgsql(connectionString));
builder.Services.AddHostedService<MqttHostedService>();

// SignalR & JWT
builder.Services.AddSignalR();
var jwtKey = "DayLaMotChuoiBaoMatCucKyDaiVaPhucTapChoKhoaHocIOTLogistics2024!";
var keyBytes = Encoding.ASCII.GetBytes(jwtKey);

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options => {
        options.TokenValidationParameters = new TokenValidationParameters {
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(keyBytes),
            ValidateIssuer = false,
            ValidateAudience = false
        };
    });
builder.Services.AddAuthorization();

builder.Services.AddCors(options => {
    options.AddPolicy("AllowReactApp",
        policy => policy.WithOrigins("http://localhost:5173") 
              .AllowAnyMethod()
              .AllowAnyHeader()
              .AllowCredentials()); 
});

var app = builder.Build();

app.UseCors("AllowReactApp");
app.UseAuthentication();
app.UseAuthorization();

app.MapHub<TrackingHub>("/trackingHub");

// =======================================================
// API ĐĂNG NHẬP
// =======================================================
app.MapPost("/api/auth/login", async (LoginRequest req, AppDbContext db) =>
{
    var user = await db.Users.FirstOrDefaultAsync(u => u.Username == req.Username && u.Password == req.Password);
    if (user == null) return Results.Unauthorized();

    var tokenHandler = new JwtSecurityTokenHandler();
    var tokenDescriptor = new SecurityTokenDescriptor {
        Subject = new ClaimsIdentity(new[] {
            new Claim(ClaimTypes.Name, user.Username),
            new Claim(ClaimTypes.Role, user.Role),
            new Claim("VehicleId", user.AssignedVehicleId ?? "")
        }),
        Expires = DateTime.UtcNow.AddDays(1),
        SigningCredentials = new SigningCredentials(new SymmetricSecurityKey(keyBytes), SecurityAlgorithms.HmacSha256Signature)
    };
    var token = tokenHandler.CreateToken(tokenDescriptor);
    
    return Results.Ok(new { 
        Token = tokenHandler.WriteToken(token), 
        Role = user.Role, 
        VehicleId = user.AssignedVehicleId,
        Username = user.Username
    });
});

// =======================================================
// CÁC API CÓ BẢO MẬT
// =======================================================
app.MapGet("/api/tracking/history", async (AppDbContext db) => {
    var history = await db.TrackingLogs.OrderByDescending(t => t.Timestamp).Take(100).ToListAsync();
    return Results.Ok(history);
}).RequireAuthorization();

app.MapGet("/api/tracking/analytics", async (AppDbContext db) => {
    var logs = await db.TrackingLogs.ToListAsync();
    if (!logs.Any()) return Results.Ok(new { AverageSpeed = 0, MaxSpeed = 0, DriverScore = 100, TotalRecords = 0, EstimatedFuel = 0 });
    var avgSpeed = logs.Average(l => l.Speed);
    var speedingCount = logs.Count(l => l.Speed > 60);
    return Results.Ok(new { 
        AverageSpeed = Math.Round(avgSpeed, 1), MaxSpeed = logs.Max(l => l.Speed), 
        DriverScore = Math.Max(0, 100 - (speedingCount * 5)), TotalRecords = logs.Count,
        EstimatedFuel = Math.Round(logs.Sum(l => l.Speed * (3.0 / 3600.0)) * 0.2, 2) 
    });
}).RequireAuthorization(policy => policy.RequireRole("Admin"));

app.MapGet("/api/parking", async (AppDbContext db) => Results.Ok(await db.ParkingSpots.ToListAsync())).RequireAuthorization();

app.MapPost("/api/parking/book", async (string vehicleId, int spotId, AppDbContext db) => {
    var spot = await db.ParkingSpots.FindAsync(spotId);
    if (!spot!.IsAvailable) return Results.BadRequest("Bãi đỗ xe đã có người đặt.");
    spot.IsAvailable = false; spot.BookedByVehicleId = vehicleId;
    await db.SaveChangesAsync();
    return Results.Ok(new { Message = $"Xe {vehicleId} đặt thành công!" });
}).RequireAuthorization(policy => policy.RequireRole("Driver"));

// =======================================================
// KHỞI TẠO DỮ LIỆU
// =======================================================
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    if (!db.ParkingSpots.Any()) {
        db.ParkingSpots.AddRange(
            new ParkingSpot { Name = "Bãi đỗ Tân Bình", Latitude = 10.7950, Longitude = 106.6600, IsAvailable = true },
            new ParkingSpot { Name = "Bãi đỗ Quận 1", Latitude = 10.7750, Longitude = 106.7000, IsAvailable = true },
            new ParkingSpot { Name = "Bãi đỗ Thủ Đức", Latitude = 10.8500, Longitude = 106.7500, IsAvailable = true }
        );
        db.SaveChanges();
    }
    if (!db.Users.Any()) {
        db.Users.AddRange(
            new User { Username = "admin", Password = "123", Role = "Admin", AssignedVehicleId = null },
            new User { Username = "driver1", Password = "123", Role = "Driver", AssignedVehicleId = "TRUCK_HCM_01" },
            new User { Username = "driver2", Password = "123", Role = "Driver", AssignedVehicleId = "TRUCK_HCM_02" },
            new User { Username = "driver3", Password = "123", Role = "Driver", AssignedVehicleId = "TRUCK_HCM_03" }
        );
        db.SaveChanges();
    }
}

app.Run();

// Class bắt buộc để dưới cùng
public class LoginRequest { public string Username { get; set; } = ""; public string Password { get; set; } = ""; }