"""Shiroi PVLib Microservice — fallback PV yield simulation when PVWatts is unavailable.

API contract matches apps/erp/src/lib/pvwatts.ts so the ERP can swap between
PVWatts and this service transparently.

Data source: PVGIS TMY (free, no API key) — works globally including India.
Model: pvlib's pvwatts_dc + pvwatts inverter — matches NREL PVWatts v8 approach.
"""

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
import pvlib
from pvlib.iotools import get_pvgis_tmy
from pvlib.location import Location
import pandas as pd
import logging
import os

logging.basicConfig(level=os.environ.get("LOG_LEVEL", "info").upper())
log = logging.getLogger("pvlib-microservice")

app = FastAPI(title="Shiroi PVLib Microservice", version="1.0.0")


class SimulateRequest(BaseModel):
    system_capacity: float = Field(..., gt=0, description="System DC capacity in kW")
    lat: float = Field(..., ge=-90, le=90)
    lon: float = Field(..., ge=-180, le=180)
    tilt: float = Field(..., ge=0, le=90)
    azimuth: float = Field(..., ge=0, le=360)
    module_type: int = Field(1, ge=0, le=2)
    losses: float = Field(14.0, ge=0, le=99)


class SimulateResponse(BaseModel):
    monthly_kwh: list[float]
    annual_kwh: float


@app.get("/health")
def health():
    return {"status": "ok", "pvlib_version": pvlib.__version__}


@app.post("/simulate", response_model=SimulateResponse)
def simulate(req: SimulateRequest):
    op = "[simulate]"
    log.info(
        f"{op} sys={req.system_capacity}kW lat={req.lat} lon={req.lon} "
        f"tilt={req.tilt} az={req.azimuth} losses={req.losses}%"
    )
    try:
        tmy_data, _, _, _ = get_pvgis_tmy(
            latitude=req.lat,
            longitude=req.lon,
            map_variables=True,
            outputformat="json",
            usehorizon=True,
        )
    except Exception as e:
        log.error(f"{op} PVGIS TMY fetch failed: {e}")
        raise HTTPException(status_code=502, detail=f"PVGIS TMY fetch failed: {e}")

    try:
        location = Location(latitude=req.lat, longitude=req.lon, tz="UTC")
        solar_position = location.get_solarposition(tmy_data.index)

        poa = pvlib.irradiance.get_total_irradiance(
            surface_tilt=req.tilt,
            surface_azimuth=req.azimuth,
            solar_zenith=solar_position["apparent_zenith"],
            solar_azimuth=solar_position["azimuth"],
            dni=tmy_data["dni"],
            ghi=tmy_data["ghi"],
            dhi=tmy_data["dhi"],
        )

        # Cell temperature using SAPM model (more accurate than ambient)
        temp_cell = pvlib.temperature.sapm_cell(
            poa_global=poa["poa_global"],
            temp_air=tmy_data["temp_air"],
            wind_speed=tmy_data.get("wind_speed", pd.Series(1.0, index=tmy_data.index)),
            a=-3.56,
            b=-0.075,
            deltaT=3,
        )

        # PVWatts DC model: c-Si premium gamma_pdc = -0.0035, standard -0.0045, thin-film -0.0020
        gamma_pdc_map = {0: -0.0045, 1: -0.0035, 2: -0.0020}
        gamma_pdc = gamma_pdc_map.get(req.module_type, -0.0035)

        dc = pvlib.pvsystem.pvwatts_dc(
            g_poa_effective=poa["poa_global"],
            temp_cell=temp_cell,
            pdc0=req.system_capacity * 1000,
            gamma_pdc=gamma_pdc,
        )

        # System losses (soiling, wiring, mismatch, etc.) — matches PVWatts default 14%
        dc_after_losses = dc * (1 - req.losses / 100)

        # Inverter conversion — 96% nominal, same as PVWatts default
        ac = pvlib.inverter.pvwatts(
            pdc=dc_after_losses,
            pdc0=req.system_capacity * 1000,
            eta_inv_nom=0.96,
        )

        ac_series = pd.Series(ac.values, index=tmy_data.index).fillna(0).clip(lower=0)
        # PVGIS TMY may select different source years per month (e.g. Jan 2005,
        # Feb 2008, Mar 2010...), so we group by calendar month-of-year (1-12),
        # NOT by absolute time bucket. resample("ME") would create a bucket per
        # month-of-time and collapse everything into the first bucket.
        monthly_grouped_wh = ac_series.groupby(ac_series.index.month).sum()
        monthly_kwh = [float(monthly_grouped_wh.get(m, 0.0)) / 1000.0 for m in range(1, 13)]
        annual_kwh = float(sum(monthly_kwh))

        log.info(f"{op} done: annual={annual_kwh:.1f} kWh, monthly={[round(m,1) for m in monthly_kwh]}")
        return SimulateResponse(monthly_kwh=monthly_kwh, annual_kwh=annual_kwh)

    except Exception as e:
        log.exception(f"{op} simulation failed")
        raise HTTPException(status_code=500, detail=f"Simulation error: {e}")
