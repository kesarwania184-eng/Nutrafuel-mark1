from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

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


@app.get("/")
def root() -> dict:
    return {"service": "nutrifit-recipe-engine", "docs": "/docs"}
