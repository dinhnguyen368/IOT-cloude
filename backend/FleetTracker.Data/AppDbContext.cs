using FleetTracker.Core;
using Microsoft.EntityFrameworkCore;

namespace FleetTracker.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    // Đại diện cho bảng TrackingLogs trong Database
    public DbSet<TrackingLog> TrackingLogs { get; set; }
    public DbSet<ParkingSpot> ParkingSpots { get; set; }
}