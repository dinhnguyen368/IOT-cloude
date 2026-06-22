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

public class MqttHostedService : IHostedService
{
    private IMqttClient? _mqttClient;
    private MqttClientOptions? _mqttOptions;
    private readonly IServiceScopeFactory _scopeFactory; 
    private readonly IHubContext<TrackingHub> _hubContext; // <-- Khai báo Hub
    
    private const string Broker = "localhost"; 
    private const string Topic = "logistics/fleet/truck_hcm_01";

    public MqttHostedService(IServiceScopeFactory scopeFactory, IHubContext<TrackingHub> hubContext)
    {
        _scopeFactory = scopeFactory;
        _hubContext = hubContext; // <-- Tiêm Hub vào Service
    }

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        var factory = new MqttFactory();
        _mqttClient = factory.CreateMqttClient();

        _mqttOptions = new MqttClientOptionsBuilder()
            .WithClientId("DotNet_Backend_" + Guid.NewGuid().ToString())
            .WithTcpServer(Broker, 1883)
            .Build();

        _mqttClient.ApplicationMessageReceivedAsync += async e =>
        {
            var payload = Encoding.UTF8.GetString(e.ApplicationMessage.PayloadSegment);
            try 
            {
                var options = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };
                var logData = JsonSerializer.Deserialize<TrackingLog>(payload, options);

                if (logData != null)
                {
                    logData.Timestamp = logData.Timestamp.ToUniversalTime();

                    using (var scope = _scopeFactory.CreateScope())
                    {
                        var dbContext = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                        dbContext.TrackingLogs.Add(logData);
                        await dbContext.SaveChangesAsync(); 

                        // Tính toán lại Analytics ngay lập tức
                        var logs = await dbContext.TrackingLogs.ToListAsync();
                        var analytics = new {
                            AverageSpeed = Math.Round(logs.Average(l => l.Speed), 1),
                            MaxSpeed = logs.Max(l => l.Speed),
                            DriverScore = Math.Max(0, 100 - (logs.Count(l => l.Speed > 60) * 5)),
                            TotalRecords = logs.Count,
                            EstimatedFuel = Math.Round(logs.Sum(l => l.Speed * (3.0 / 3600.0)) * 0.2, 2)
                        };

                        // --- ĐÂY LÀ PHÉP MÀU: BẮN DỮ LIỆU THẲNG XUỐNG REACT MÀ KHÔNG CẦN REACT GỌI API ---
                        await _hubContext.Clients.All.SendAsync("ReceiveNewLog", logData);
                        await _hubContext.Clients.All.SendAsync("UpdateAnalytics", analytics);
                    }

                    Console.ForegroundColor = ConsoleColor.Cyan;
                    Console.WriteLine($"[WEBSOCKET PUSH] Xe: {logData.VehicleId} | Nhiệt độ: {logData.Temperature}°C");
                    Console.ResetColor();
                }
            }
            catch (Exception ex) { Console.WriteLine($"LỖI: {ex.Message}"); }
        };

        await _mqttClient.ConnectAsync(_mqttOptions, cancellationToken);
        var subOptions = factory.CreateSubscribeOptionsBuilder().WithTopicFilter(f => f.WithTopic(Topic)).Build();
        await _mqttClient.SubscribeAsync(subOptions, cancellationToken);
    }

    public async Task StopAsync(CancellationToken cancellationToken)
    {
        if (_mqttClient != null) await _mqttClient.DisconnectAsync(new MqttClientDisconnectOptionsBuilder().Build(), cancellationToken);
    }
}