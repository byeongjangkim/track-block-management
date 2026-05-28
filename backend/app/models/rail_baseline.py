from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class RailRoute(Base):
    __tablename__ = "rail_routes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    korail_route_code: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    # 고속선 | 일반선 — DB 레벨 분류 (route_code suffix 방식 대체)
    line_type: Mapped[str] = mapped_column(String(20), nullable=False, default="일반선")
    route_category: Mapped[str | None] = mapped_column(String(50), nullable=True)
    start_station_code: Mapped[str | None] = mapped_column(String(30), nullable=True)
    start_station_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    start_lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    start_lon: Mapped[float | None] = mapped_column(Float, nullable=True)
    end_station_code: Mapped[str | None] = mapped_column(String(30), nullable=True)
    end_station_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    end_lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    end_lon: Mapped[float | None] = mapped_column(Float, nullable=True)
    start_kp: Mapped[float | None] = mapped_column(Float, nullable=True)
    end_kp: Mapped[float | None] = mapped_column(Float, nullable=True)
    length_kp: Mapped[float | None] = mapped_column(Float, nullable=True)
    station_point_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    calculation_basis: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    source_file: Mapped[str | None] = mapped_column(String(255), nullable=True)
    imported_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.current_timestamp(), nullable=False)

    station_points: Mapped[list["RailRouteStationPoint"]] = relationship(back_populates="rail_route")
    baseline_points: Mapped[list["RailBaselinePoint"]] = relationship(back_populates="rail_route")
    facilities: Mapped[list["RailFacility"]] = relationship(back_populates="rail_route")
    computed_geometry: Mapped[list["RailComputedGeometry"]] = relationship(back_populates="rail_route")


class RailStation(Base):
    __tablename__ = "rail_stations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    station_code: Mapped[str] = mapped_column(String(30), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    lon: Mapped[float | None] = mapped_column(Float, nullable=True)
    station_role: Mapped[str | None] = mapped_column(String(20), nullable=True)
    station_type: Mapped[str | None] = mapped_column(String(20), nullable=True)
    match_note: Mapped[str | None] = mapped_column(String(255), nullable=True)
    source_file: Mapped[str | None] = mapped_column(String(255), nullable=True)
    imported_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.current_timestamp(), nullable=False)

    route_points: Mapped[list["RailRouteStationPoint"]] = relationship(back_populates="station")
    baseline_points: Mapped[list["RailBaselinePoint"]] = relationship(back_populates="station")
    managed_groups: Mapped[list["RailStationManagementGroup"]] = relationship(back_populates="manager_station")
    management_memberships: Mapped[list["RailStationManagementMember"]] = relationship(back_populates="station")
    nearby_facilities: Mapped[list["RailFacility"]] = relationship(back_populates="nearest_station")


class RailRouteStationPoint(Base):
    __tablename__ = "rail_route_station_points"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    rail_route_id: Mapped[int] = mapped_column(ForeignKey("rail_routes.id"), nullable=False)
    station_id: Mapped[int] = mapped_column(ForeignKey("rail_stations.id"), nullable=False)
    route_sequence_no: Mapped[int | None] = mapped_column(Integer, nullable=True)
    center_kp: Mapped[float | None] = mapped_column(Float, nullable=True)
    yard_start_kp: Mapped[float | None] = mapped_column(Float, nullable=True)
    yard_end_kp: Mapped[float | None] = mapped_column(Float, nullable=True)
    main_track_speed: Mapped[float | None] = mapped_column(Float, nullable=True)
    side_track_speed: Mapped[float | None] = mapped_column(Float, nullable=True)
    functional_location_no: Mapped[str | None] = mapped_column(String(80), nullable=True)
    plant_code: Mapped[str | None] = mapped_column(String(30), nullable=True)
    regional_org: Mapped[str | None] = mapped_column(String(100), nullable=True)
    distance_from_prev: Mapped[float | None] = mapped_column(Float, nullable=True)
    direction_distance: Mapped[float | None] = mapped_column(Float, nullable=True)
    is_baseline_anchor: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    match_note: Mapped[str | None] = mapped_column(String(255), nullable=True)
    source_row: Mapped[int | None] = mapped_column(Integer, nullable=True)
    source_file: Mapped[str | None] = mapped_column(String(255), nullable=True)
    imported_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.current_timestamp(), nullable=False)

    rail_route: Mapped["RailRoute"] = relationship(back_populates="station_points")
    station: Mapped["RailStation"] = relationship(back_populates="route_points")


class RailBaselinePoint(Base):
    __tablename__ = "rail_baseline_points"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    rail_route_id: Mapped[int] = mapped_column(ForeignKey("rail_routes.id"), nullable=False)
    segment_no: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    kp: Mapped[float] = mapped_column(Float, nullable=False)
    lat: Mapped[float] = mapped_column(Float, nullable=False)
    lon: Mapped[float] = mapped_column(Float, nullable=False)
    point_type: Mapped[str] = mapped_column(String(40), nullable=False)
    source_type: Mapped[str] = mapped_column(String(40), nullable=False)
    source_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    station_id: Mapped[int | None] = mapped_column(ForeignKey("rail_stations.id"), nullable=True)
    rail_facility_id: Mapped[int | None] = mapped_column(ForeignKey("rail_facilities.id"), nullable=True)
    is_interpolation_anchor: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    is_render_anchor: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.current_timestamp(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.current_timestamp(), nullable=False)

    rail_route: Mapped["RailRoute"] = relationship(back_populates="baseline_points")
    station: Mapped["RailStation"] = relationship(back_populates="baseline_points")
    rail_facility: Mapped["RailFacility"] = relationship(back_populates="baseline_points")


class RailFacility(Base):
    __tablename__ = "rail_facilities"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    rail_route_id: Mapped[int] = mapped_column(ForeignKey("rail_routes.id"), nullable=False)
    facility_code: Mapped[str | None] = mapped_column(String(50), nullable=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    classification_id: Mapped[int] = mapped_column(
        ForeignKey("rail_facility_classifications.id"), nullable=False
    )
    kp_start: Mapped[float | None] = mapped_column(Float, nullable=True)
    kp_end: Mapped[float | None] = mapped_column(Float, nullable=True)
    lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    lon: Mapped[float | None] = mapped_column(Float, nullable=True)
    lat_end: Mapped[float | None] = mapped_column(Float, nullable=True)
    lon_end: Mapped[float | None] = mapped_column(Float, nullable=True)
    direction: Mapped[str | None] = mapped_column(String(10), nullable=True)
    section_from: Mapped[str | None] = mapped_column(Text, nullable=True)
    section_to: Mapped[str | None] = mapped_column(Text, nullable=True)
    address: Mapped[str | None] = mapped_column(Text, nullable=True)
    road_width_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    is_paved: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    bus_accessible: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    entrance_passage_type: Mapped[str | None] = mapped_column(Text, nullable=True)
    entrance_lock_type: Mapped[str | None] = mapped_column(Text, nullable=True)
    nearest_station_id: Mapped[int | None] = mapped_column(ForeignKey("rail_stations.id"), nullable=True)
    management_office_id: Mapped[int | None] = mapped_column(
        ForeignKey("rail_facility_management_offices.id"), nullable=True
    )
    use_as_baseline_anchor: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    source_file: Mapped[str | None] = mapped_column(String(255), nullable=True)
    source_row: Mapped[int | None] = mapped_column(Integer, nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.current_timestamp(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.current_timestamp(), nullable=False)

    rail_route: Mapped["RailRoute"] = relationship(back_populates="facilities")
    classification: Mapped["RailFacilityClassification"] = relationship(back_populates="facilities")
    nearest_station: Mapped["RailStation"] = relationship(back_populates="nearby_facilities")
    management_office: Mapped["RailFacilityManagementOffice"] = relationship(back_populates="facilities")
    baseline_points: Mapped[list["RailBaselinePoint"]] = relationship(back_populates="rail_facility")


class RailFacilityClassification(Base):
    __tablename__ = "rail_facility_classifications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    major_category: Mapped[str] = mapped_column(String(30), nullable=False)
    sub_category: Mapped[str] = mapped_column(String(50), nullable=False)
    detail_category: Mapped[str | None] = mapped_column(String(30), nullable=True)
    tertiary_category: Mapped[str | None] = mapped_column(String(30), nullable=True)
    geometry_type: Mapped[str] = mapped_column(String(20), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.current_timestamp(), nullable=False)

    facilities: Mapped[list["RailFacility"]] = relationship(back_populates="classification")


class RailFacilityManagementOffice(Base):
    __tablename__ = "rail_facility_management_offices"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    organization_id: Mapped[int] = mapped_column(ForeignKey("organizations.id"), nullable=False)
    region_name: Mapped[str] = mapped_column(String(100), nullable=False)
    office_name: Mapped[str] = mapped_column(String(100), nullable=False)
    office_type: Mapped[str] = mapped_column(String(30), nullable=False, default="사업소")
    field: Mapped[str] = mapped_column(String(20), nullable=False, default="all")
    source_file: Mapped[str | None] = mapped_column(String(255), nullable=True)
    source_row: Mapped[int | None] = mapped_column(Integer, nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    imported_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.current_timestamp(), nullable=False)

    facilities: Mapped[list["RailFacility"]] = relationship(back_populates="management_office")


class RailRouteRegionBoundary(Base):
    __tablename__ = "rail_route_region_boundaries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    organization_id: Mapped[int] = mapped_column(ForeignKey("organizations.id"), nullable=False)
    rail_route_id: Mapped[int] = mapped_column(ForeignKey("rail_routes.id"), nullable=False)
    region_name: Mapped[str] = mapped_column(String(100), nullable=False)
    boundary_type: Mapped[str] = mapped_column(String(30), nullable=False, default="지역본부")
    start_kp: Mapped[float] = mapped_column(Float, nullable=False)
    end_kp: Mapped[float] = mapped_column(Float, nullable=False)
    source_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    source_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.current_timestamp(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.current_timestamp(), nullable=False)

    rail_route: Mapped["RailRoute"] = relationship()


class RailStationManagementGroup(Base):
    __tablename__ = "rail_station_management_groups"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    organization_id: Mapped[int | None] = mapped_column(ForeignKey("organizations.id"), nullable=True)
    region_name: Mapped[str] = mapped_column(String(100), nullable=False)
    manager_station_id: Mapped[int] = mapped_column(ForeignKey("rail_stations.id"), nullable=False)
    manager_station_name: Mapped[str] = mapped_column(String(100), nullable=False)
    source_file: Mapped[str | None] = mapped_column(String(255), nullable=True)
    source_row: Mapped[int | None] = mapped_column(Integer, nullable=True)
    imported_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.current_timestamp(), nullable=False)

    manager_station: Mapped["RailStation"] = relationship(back_populates="managed_groups")
    members: Mapped[list["RailStationManagementMember"]] = relationship(back_populates="management_group")


class RailStationManagementMember(Base):
    __tablename__ = "rail_station_management_members"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    management_group_id: Mapped[int] = mapped_column(
        ForeignKey("rail_station_management_groups.id"), nullable=False
    )
    station_id: Mapped[int] = mapped_column(ForeignKey("rail_stations.id"), nullable=False)
    station_name: Mapped[str] = mapped_column(String(100), nullable=False)
    station_role: Mapped[str] = mapped_column(String(20), nullable=False)
    station_type: Mapped[str] = mapped_column(String(20), nullable=False)
    match_status: Mapped[str] = mapped_column(String(30), nullable=False)
    source_order: Mapped[int] = mapped_column(Integer, nullable=False)
    source_file: Mapped[str | None] = mapped_column(String(255), nullable=True)
    source_row: Mapped[int | None] = mapped_column(Integer, nullable=True)
    imported_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.current_timestamp(), nullable=False)

    management_group: Mapped["RailStationManagementGroup"] = relationship(back_populates="members")
    station: Mapped["RailStation"] = relationship(back_populates="management_memberships")


class RailComputedGeometry(Base):
    """역·시설물 KP+GPS anchor에서 보간 생성한 노선 좌표 계열 (최종 노선도 SOT)."""

    __tablename__ = "rail_computed_geometry"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    rail_route_id: Mapped[int] = mapped_column(ForeignKey("rail_routes.id"), nullable=False)
    # 역정규화: JOIN 없이 고속선/일반선 필터 가능
    line_type: Mapped[str] = mapped_column(String(20), nullable=False, default="일반선")
    kp: Mapped[float] = mapped_column(Float, nullable=False)
    lat: Mapped[float] = mapped_column(Float, nullable=False)
    lon: Mapped[float] = mapped_column(Float, nullable=False)
    # station | facility | interpolated | manual
    source: Mapped[str] = mapped_column(String(20), nullable=False, default="interpolated")
    # high | mid | low
    lod: Mapped[str] = mapped_column(String(10), nullable=False, default="high")
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    computed_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.current_timestamp(), nullable=False)

    rail_route: Mapped["RailRoute"] = relationship(back_populates="computed_geometry")
