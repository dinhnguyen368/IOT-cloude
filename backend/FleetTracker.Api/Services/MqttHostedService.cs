using System.Text;
using System.Text.Json;
using FleetTracker.Core;
using FleetTracker.Data;
using MQTTnet;
using MQTTnet.Client;

namespace FleetTracker.Api.Services;

public class MqttHostedService : IHostedService
{
    private IMqttClient? _mqttClient;
    private MqttClientOptions? _mqttOptions;
    private readonly IServiceScopeFactory _scopeFactory; 
    
    private const string Broker = "localhost"; 
    private const string Topic = "logistics/fleet/truck_hcm_01";

    public MqttHostedService(IServiceScopeFactory scopeFactory)
    {
        _scopeFactory = scopeFactory;
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
                    // ĐÂY CHÍNH LÀ DÒNG FIX LỖI: Ép thời gian về chuẩn quốc tế (UTC) cho PostgreSQL
                    logData.Timestamp = logData.Timestamp.ToUniversalTime();

                    using (var scope = _scopeFactory.CreateScope())
                    {
                        var dbContext = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                        dbContext.TrackingLogs.Add(logData);
                        await dbContext.SaveChangesAsync(); 
                    }

                    Console.ForegroundColor = ConsoleColor.Cyan;
                    Console.WriteLine($"[ĐÃ LƯU VÀO DB] Xe: {logData.VehicleId} | Tốc độ: {logData.Speed} km/h | Vị trí: {logData.Latitude}, {logData.Longitude}");
                    Console.ResetColor();
                }
            }
            catch (Exception ex)
            {
                Console.ForegroundColor = ConsoleColor.Red;
                Console.WriteLine($"[LỖI LƯU DB]: {ex.Message}");
                Console.ResetColor();
            }
        };

        await _mqttClient.ConnectAsync(_mqttOptions, cancellationToken);
        var subscribeOptions = factory.CreateSubscribeOptionsBuilder()
            .WithTopicFilter(f => f.WithTopic(Topic))
            .Build();
            
        await _mqttClient.SubscribeAsync(subscribeOptions, cancellationToken);
        
        Console.WriteLine("-------------------------------------------------");
        Console.WriteLine(" [.NET IoT Platform] Đã kết nối MQTT Broker & Sẵn sàng lưu PostgreSQL.");
        Console.WriteLine("-------------------------------------------------");
    }

    public async Task StopAsync(CancellationToken cancellationToken)
    {
        if (_mqttClient != null)
        {
            await _mqttClient.DisconnectAsync(new MqttClientDisconnectOptionsBuilder().Build(), cancellationToken);
        }
    }
}