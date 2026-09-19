from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api.routes import router


app = FastAPI(
    title="NutriFit Recipe Nutrition Engine",
    version="1.0.0",
    description=(
        "Deterministic nutrition for homemade Indian recipes. The language model "
        "parses text into structure; every number is computed from reference tables."
    ),
)


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(router)


STATIC_DIR = Path(__file__).resolve().parent / "static"

app.mount(
    "/static",
    StaticFiles(directory=STATIC_DIR),
    name="static",
)


@app.get("/")
def root():
    return FileResponse(STATIC_DIR / "index.html")