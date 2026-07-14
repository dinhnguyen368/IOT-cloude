using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using FleetTracker.Api.Hubs;
using FleetTracker.Api.Services;
using FleetTracker.Core;
using FleetTracker.Data;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using MQTTnet;
using MQTTnet.Client;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

// Cấu hình Database & MQTT
var connectionString = builder.Configuration.GetConnectionString("DefaultConnection");
builder.Services.AddDbContext<AppDbContext>(options => options.UseNpgsql(connectionString));
builder.Services.AddHostedService<MqttHostedService>();

// SignalR & JWT
builder.Services.AddSignalR(options => {
    options.KeepAliveInterval = TimeSpan.FromSeconds(15);
    options.ClientTimeoutInterval = TimeSpan.FromMinutes(2);
});
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

        // ==============================================================
        // BẢN VÁ LỖI: BẮT TOKEN TỪ URL DÀNH RIÊNG CHO SIGNALR/WEBSOCKETS
        // ==============================================================
        options.Events = new JwtBearerEvents
        {
            OnMessageReceived = context =>
            {
                var accessToken = context.Request.Query["access_token"];
                var path = context.HttpContext.Request.Path;
                if (!string.IsNullOrEmpty(accessToken) && path.StartsWithSegments("/trackingHub"))
                {
                    context.Token = accessToken;
                }
                return Task.CompletedTask;
            }
        };
    });
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowReactApp", policy =>
    {
        policy.WithOrigins(
                "http://localhost:5173", 
                "https://iot-cloude-git-main-nguyen12.vercel.app", // Link cũ (cứ để lại không sao)
                "https://iot-cloude.vercel.app" // <-- BẠN CHỈ CẦN THÊM DÒNG NÀY VÀO LÀ XONG
              )
              .AllowAnyHeader()
              .AllowAnyMethod()
              .AllowCredentials(); 
    });
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
// CÁC API CÓ BẢO MẬT (CODE CŨ GIỮ NGUYÊN)
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
// API MỚI: SOS VÀ ĐIỀU KHIỂN THIẾT BỊ IoT 
// =======================================================

// API Gửi tín hiệu SOS khẩn cấp (Push SignalR)
app.MapPost("/api/tracking/sos", async (string vehicleId, IHubContext<TrackingHub> hubContext) => {
    var time = DateTime.Now.ToString("HH:mm:ss");
    await hubContext.Clients.All.SendAsync("ReceiveSOS", new { VehicleId = vehicleId, Time = time });
    return Results.Ok(new { Message = "Đã phát tín hiệu SOS!" });
}).RequireAuthorization(policy => policy.RequireRole("Driver"));

// API Điều khiển phần cứng và cập nhật trạng thái (Bắn qua MQTT)
app.MapPost("/api/device/control", async (string vehicleId, string command) => {
    var factory = new MqttFactory();
    using var mqttClient = factory.CreateMqttClient();
    var options = new MqttClientOptionsBuilder().WithTcpServer("broker.emqx.io", 1883).Build();
    await mqttClient.ConnectAsync(options);
    var message = new MqttApplicationMessageBuilder()
        .WithTopic("logistics/control")
        .WithPayload($"{vehicleId}|{command}") 
        .Build();
    
    await mqttClient.PublishAsync(message);
    await mqttClient.DisconnectAsync();
    return Results.Ok(new { Message = $"Đã truyền lệnh {command} xuống xe {vehicleId}" });
}).RequireAuthorization();
// -------------------------------------------------------
// API Cập nhật trạng thái và bắn SignalR tức thời cho Web
// -------------------------------------------------------
app.MapPost("/api/tracking/status", async (string vehicleId, string status, AppDbContext db, IHubContext<TrackingHub> hubContext) => {
    // 1. Lấy vị trí hiện tại của xe để xe đứng im trên bản đồ (không bị văng ra biển 0,0)
    var lastLog = await db.TrackingLogs
        .Where(t => t.VehicleId == vehicleId)
        .OrderByDescending(t => t.Timestamp)
        .FirstOrDefaultAsync();

    // 2. Tạo bản ghi trạng thái mới
    var log = new TrackingLog { 
        VehicleId = vehicleId, 
        Status = status, 
        Timestamp = DateTime.UtcNow,
        Latitude = lastLog?.Latitude ?? 10.7769, 
        Longitude = lastLog?.Longitude ?? 106.7009,
        Speed = 0, // Đã đổi trạng thái sang bốc hàng/nghỉ ngơi thì tốc độ ép về 0
        Temperature = lastLog?.Temperature ?? 0,
        Humidity = lastLog?.Humidity ?? 0
    };
    
    // 3. Lưu vào Database
    db.TrackingLogs.Add(log);
    await db.SaveChangesAsync();

    // 4. QUAN TRỌNG NHẤT: Bắn tín hiệu "ReceiveNewLog" cho Admin cập nhật ngay lập tức
    await hubContext.Clients.All.SendAsync("ReceiveNewLog", log);

    return Results.Ok(new { Message = "Đã cập nhật trạng thái thành công" });
}).RequireAuthorization();
// =======================================================
// KHỞI TẠO DỮ LIỆU
// =======================================================
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    db.Database.Migrate();
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

var port = Environment.GetEnvironmentVariable("PORT") ?? "10000";
app.Run($"http://0.0.0.0:{port}");

public class LoginRequest { public string Username { get; set; } = ""; public string Password { get; set; } = ""; }