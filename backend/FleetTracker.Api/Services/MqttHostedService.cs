using System.Text;
using System.Text.Json;
using FleetTracker.Core;
using FleetTracker.Data;
using FleetTracker.Api.Hubs;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using MQTTnet;
using MQTTnet.Client;

namespace FleetTracker.Api.Services;

// SỬA CỐT LÕI: Kế thừa BackgroundService để chạy ngầm hoàn toàn
public class MqttHostedService : BackgroundService
{
    private IMqttClient? _mqttClient;
    private readonly IServiceScopeFactory _scopeFactory; 
    private readonly IHubContext<TrackingHub> _hubContext;
    private readonly ILogger<MqttHostedService> _logger;
    
    public MqttHostedService(IServiceScopeFactory scopeFactory, IHubContext<TrackingHub> hubContext, ILogger<MqttHostedService> logger)
    {
        _scopeFactory = scopeFactory;
        _hubContext = hubContext;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("🚀 [MQTT] Tiến trình nền đang khởi động độc lập...");
        
        var factory = new MqttFactory();
        _mqttClient = factory.CreateMqttClient();

        var options = new MqttClientOptionsBuilder()
            .WithClientId("Render_Backend_" + Guid.NewGuid().ToString())
            .WithTcpServer("broker.emqx.io", 1883)
            .WithCleanSession()
            .Build();

        _mqttClient.ConnectedAsync += async e => {
            _logger.LogInformation("✅ [MQTT] Đã kết nối thành công tới đám mây EMQX.");
            var subOptions = factory.CreateSubscribeOptionsBuilder()
                .WithTopicFilter(f => f.WithTopic("logistics/fleet/truck_hcm_01")).Build();
            await _mqttClient.SubscribeAsync(subOptions, stoppingToken);
        };

        _mqttClient.DisconnectedAsync += e => {
            _logger.LogWarning("⚠️ [MQTT] Mất kết nối. Sẽ tự động thử lại...");
            return Task.CompletedTask;
        };

        _mqttClient.ApplicationMessageReceivedAsync += async e =>
        {
            var payload = Encoding.UTF8.GetString(e.ApplicationMessage.PayloadSegment);
            try 
            {
                var jsonOptions = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };
                var logData = JsonSerializer.Deserialize<TrackingLog>(payload, jsonOptions);

                if (logData != null)
                {
                    logData.Timestamp = logData.Timestamp.ToUniversalTime();
                    using (var scope = _scopeFactory.CreateScope())
                    {
                        var dbContext = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                        dbContext.TrackingLogs.Add(logData);
                        await dbContext.SaveChangesAsync(); 

                        var logs = await dbContext.TrackingLogs.ToListAsync();
                        var analytics = new {
                            AverageSpeed = Math.Round(logs.Any() ? logs.Average(l => l.Speed) : 0, 1),
                            MaxSpeed = logs.Any() ? logs.Max(l => l.Speed) : 0,
                            DriverScore = Math.Max(0, 100 - (logs.Count(l => l.Speed > 60) * 5)),
                            TotalRecords = logs.Count,
                            EstimatedFuel = Math.Round(logs.Sum(l => l.Speed * (3.0 / 3600.0)) * 0.2, 2)
                        };

                        await _hubContext.Clients.All.SendAsync("ReceiveNewLog", logData);
                        await _hubContext.Clients.All.SendAsync("UpdateAnalytics", analytics);
                    }
                }
            }
            catch (Exception ex) { _logger.LogError($"❌ Lỗi xử lý dữ liệu: {ex.Message}"); }
        };

        // VÒNG LẶP AUTO-RECONNECT: Trái tim của hệ thống phân tán
        while (!stoppingToken.IsCancellationRequested)
        {
            if (_mqttClient != null && !_mqttClient.IsConnected)
            {
                try
                {
                    _logger.LogInformation("🔄 [MQTT] Đang thử kết nối...");
                    await _mqttClient.ConnectAsync(options, stoppingToken);
                }
                catch (Exception ex)
                {
                    _logger.LogError($"❌ [MQTT] Không thể kết nối: {ex.Message}");
                }
            }
            // Chờ 5 giây rồi kiểm tra lại trạng thái kết nối
            await Task.Delay(5000, stoppingToken);
        }
    }
    
    public override async Task StopAsync(CancellationToken stoppingToken)
    {
        if (_mqttClient != null) await _mqttClient.DisconnectAsync();
        await base.StopAsync(stoppingToken);
    }
}