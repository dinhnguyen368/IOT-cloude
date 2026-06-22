using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace FleetTracker.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddColdChain : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<double>(
                name: "Humidity",
                table: "TrackingLogs",
                type: "double precision",
                nullable: false,
                defaultValue: 0.0);

            migrationBuilder.AddColumn<double>(
                name: "Temperature",
                table: "TrackingLogs",
                type: "double precision",
                nullable: false,
                defaultValue: 0.0);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Humidity",
                table: "TrackingLogs");

            migrationBuilder.DropColumn(
                name: "Temperature",
                table: "TrackingLogs");
        }
    }
}
