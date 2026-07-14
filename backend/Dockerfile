FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src

# Copy các file cấu hình dự án để khôi phục thư viện trước
COPY ["FleetTracker.Api/FleetTracker.Api.csproj", "FleetTracker.Api/"]
COPY ["FleetTracker.Core/FleetTracker.Core.csproj", "FleetTracker.Core/"]
COPY ["FleetTracker.Data/FleetTracker.Data.csproj", "FleetTracker.Data/"]
RUN dotnet restore "FleetTracker.Api/FleetTracker.Api.csproj"

# Copy toàn bộ code còn lại và tiến hành build
COPY . .
WORKDIR "/src/FleetTracker.Api"
RUN dotnet build "FleetTracker.Api.csproj" -c Release -o /app/build

FROM build AS publish
RUN dotnet publish "FleetTracker.Api.csproj" -c Release -o /app/publish /p:UseAppHost=false

# Cấu hình môi trường chạy thực tế
# Cấu hình môi trường chạy thực tế
FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS final
WORKDIR /app
COPY --from=publish /app/publish .

# Chỉ giữ lại lệnh chạy, để Port cho C# tự quyết định
ENTRYPOINT ["dotnet", "FleetTracker.Api.dll"]