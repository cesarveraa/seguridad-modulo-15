import os
import logging
import json
from typing import List, Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel
from dotenv import load_dotenv

# --------------------------------------------------
# Load environment
# --------------------------------------------------
load_dotenv()

# --------------------------------------------------
# Logging configuration
# --------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)

# --------------------------------------------------
# OpenAI client (SambaNova)
# --------------------------------------------------
from openai import OpenAI
client = OpenAI(
    api_key=os.getenv("SAMBANOVA_API_KEY"),
    base_url=os.getenv("SAMBANOVA_API_BASE", "https://api.sambanova.ai/v1"),
)

# --------------------------------------------------
# Pydantic models
# --------------------------------------------------
class LatLng(BaseModel):
    lat: float
    lng: float

class POIIn(BaseModel):
    id: str
    name: str
    types: List[str]
    lat: float
    lng: float

class ClassifyRequest(BaseModel):
    pois: List[POIIn]
    map_image_url: str

class ClassifyResponse(BaseModel):
    id: str
    nombre: str
    tipo: str
    subtipo: Optional[str]

class RiskRequest(BaseModel):
    center: LatLng
    pois: List[POIIn]
    map_image_url: Optional[str]

class RiskResponse(BaseModel):
    riesgoTotal: str
    riesgoResidual: str
    riesgoGeografico: str
    controlesExistentes: List[str]

class GeneralAnalysisRequest(BaseModel):
    descripcion: str
    pois: List[POIIn]
    image_base64: Optional[str]

class GeneralAnalysisResponse(BaseModel):
    summary: str

class ControlsRequest(BaseModel):
    pois: List[POIIn]
    image_base64: Optional[str]

class ControlsResponse(BaseModel):
    controles: List[str]

# --------------------------------------------------
# FastAPI setup
# --------------------------------------------------
app = FastAPI(title="Servicio de Clasificación y Análisis de POIs", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    body = await request.body()
    logger.error("Validation error: %s\nBody: %s", exc.errors(), body)
    return JSONResponse(status_code=422, content={"detail": exc.errors()})

# --------------------------------------------------
# 1) /classify
# --------------------------------------------------
@app.post("/classify", response_model=List[ClassifyResponse])
async def classify_pois(req: ClassifyRequest, request: Request):
    logger.info("Received classify request: %s", req.dict())
    places_text = "\n".join(
        f"- {p.id}: {p.name} (types: {', '.join(p.types)}) @ [{p.lat:.6f},{p.lng:.6f}]"
        for p in req.pois
    )
    prompt = (
        "Por favor, realiza lo siguiente:\n"
        "1. Clasifica cada punto de interés según esta leyenda con los códigos indicados:\n"
        "   - PR: Puntos de Riesgo\n"
        "   - PN: Puntos Neutros\n"
        "   - PA: Puntos de Apoyo\n"
        "   - Va: Vialidad de Acceso\n"
        "   - Ve: Vialidad de Egreso\n"
        "   - inundacion: Zonas de Inundación\n"
        "   - deslizamiento: Zonas de Deslizamiento\n"
        "2. Después de la línea '### JSON', devuelve únicamente un JSON que sea un array de objetos\n"
        "   con las llaves: 'id', 'nombre', 'tipo', 'subtipo'.\n"
        "   - 'tipo' debe ser uno de: PR, PN, PA, Va, Ve, inundacion, deslizamiento.\n"
        "   - 'subtipo' puede ser string o null.\n"
        f"Lista de POIs:\n{places_text}\n"
        "### JSON\n"
    )
    logger.info("Prompt to LLM:\n%s", prompt)
    try:
        resp = client.chat.completions.create(
            model="Llama-4-Maverick-17B-128E-Instruct",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.0,
            top_p=1.0,
        )
        llm_output = resp.choices[0].message.content
        logger.info("LLM raw output:\n%s", llm_output)
    except Exception as e:
        logger.error("Error calling LLM: %s", e)
        raise HTTPException(status_code=500, detail=f"Error en LLM: {e}")

    if '### JSON' not in llm_output:
        raise HTTPException(status_code=500, detail="Formato de respuesta inválido del LLM")
    _, json_part = llm_output.split('### JSON', 1)
    json_str = json_part.strip()
    if json_str.startswith('```'):
        lines = json_str.splitlines()
        json_str = "\n".join(l for l in lines if not l.strip().startswith('```'))
    logger.info("Clean JSON string:\n%s", json_str)

    try:
        parsed = json.loads(json_str)
    except Exception as e:
        logger.error("Error parsing LLM JSON: %s", e)
        raise HTTPException(status_code=500, detail=f"Error parsing JSON de LLM: {e}")

    mapping = {item['id']: item for item in parsed if 'id' in item}
    result: List[ClassifyResponse] = []
    for p in req.pois:
        item = mapping.get(p.id)
        if item:
            result.append(ClassifyResponse(
                id=item['id'],
                nombre=item.get('nombre', p.name),
                tipo=item.get('tipo','PN'),
                subtipo=item.get('subtipo')
            ))
        else:
            result.append(ClassifyResponse(id=p.id, nombre=p.name, tipo='PN', subtipo=None))
    logger.info("Returning classified POIs: %s", result)
    return result

# --------------------------------------------------
# 2) /analyze-risk (prompt JSON-only y logging/fallback)
# --------------------------------------------------
@app.post("/analyze-risk", response_model=RiskResponse)
async def analyze_risk(req: RiskRequest):
    logger.info("Received risk analysis request: %s", req.dict())

    # 1) Construir prompt muy explícito (JSON-only)
    places_text = "\n".join(
        f"- {p.id}: {p.name} @ [{p.lat:.6f},{p.lng:.6f}] (types: {', '.join(p.types)})"
        for p in req.pois
    )
    prompt = (
        "Eres un analista de riesgos perimetrales.\n"
        "Recibes la ubicación del centro y una lista de POIs.\n"
        "**IMPORTANTE**: Devuelve _únicamente_ un JSON con la siguiente estructura:\n"
        "{\n"
        '  "riesgoTotal": "Bajo|Medio|Alto",\n'
        '  "riesgoResidual": "Bajo|Medio|Alto",\n'
        '  "riesgoGeografico": "A|I|D",\n'
        '  "controlesExistentes": [string...]\n'
        "}\n"
        f"Centro: [{req.center.lat:.6f},{req.center.lng:.6f}]\n"
        f"POIs:\n{places_text}\n"
    )
    logger.debug("Prompt to LLM:\n%s", prompt)

    # 2) Llamada al LLM
    try:
        resp = client.chat.completions.create(
            model="Llama-4-Maverick-17B-128E-Instruct",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.0, top_p=1.0,
        )
        raw = resp.choices[0].message.content
        logger.info("LLM risk output received (len=%d)", len(raw))
        logger.debug("LLM raw output:\n%s", raw)
    except Exception as e:
        logger.error("Error calling LLM for risk: %s", e)
        return _simulate_risk(req)

    # 3) Limpiar y parsear JSON
    fragment = raw.strip().lstrip("```").rstrip("```").strip()
    logger.debug("Cleaned JSON fragment:\n%s", fragment)

    try:
        data = json.loads(fragment)
        logger.info("Parsed risk JSON successfully: %s", data)
        return RiskResponse(**data)
    except Exception as e:
        logger.error("Error parsing risk JSON: %s", e)
        logger.error("Bad JSON fragment was:\n%s", fragment)
        return _simulate_risk(req)


def _simulate_risk(req: RiskRequest) -> RiskResponse:
    """
    Fallback de simulación si el LLM no devuelve un JSON válido.
    """
    logger.info("Running fallback risk simulation")
    countPR = sum(1 for p in req.pois if "PR" in p.types)
    countPA = sum(1 for p in req.pois if "PA" in p.types)

    # Lógica de simulación
    if countPR > 3:
        riesgoTotal = "Alto"
    elif countPR <= 1 and countPA > 2:
        riesgoTotal = "Bajo"
    else:
        riesgoTotal = "Medio"

    riesgoResidual = "Medio" if riesgoTotal == "Alto" else "Bajo"
    riesgoGeografico = "A" if countPR < countPA else ("D" if countPR > countPA else "I")
    controlesExistentes = [
        "Sistema de vigilancia CCTV",
        "Control de acceso biométrico",
        "Guardias de seguridad 24/7",
        "Protocolo de evacuación",
        "Sistema contra incendios",
    ]

    simulated = RiskResponse(
        riesgoTotal=riesgoTotal,
        riesgoResidual=riesgoResidual,
        riesgoGeografico=riesgoGeografico,
        controlesExistentes=controlesExistentes,
    )
    logger.info("Fallback riskResponse: %s", simulated.dict())
    return simulated


# --------------------------------------------------
# 3) /general-analysis
# --------------------------------------------------
@app.post("/general-analysis", response_model=GeneralAnalysisResponse)
async def general_analysis(req: GeneralAnalysisRequest):
    logger.info("Received general analysis request: %s", req.dict())
    pois_text = "\n".join(f"- {p.name} @ [{p.lat:.6f},{p.lng:.6f}]" for p in req.pois)
    prompt = (
        "Eres un asistente que genera un análisis general de seguridad.\n"
        f"Descripción: {req.descripcion}\n"
        f"POIs:\n{pois_text}\n"
        + ("Se incluye imagen en base64 para contexto visual.\n" if req.image_base64 else "")
        + "Devuelve un párrafo de resumen (no JSON).\n"
    )
    try:
        resp = client.chat.completions.create(
            model="Llama-4-Maverick-17B-128E-Instruct",
            messages=[{"role":"user","content":prompt}],
            temperature=0.2, top_p=0.9
        )
        summary = resp.choices[0].message.content.strip()
    except Exception as e:
        logger.error("Error general analysis LLM: %s", e)
        raise HTTPException(status_code=500, detail="Error en LLM análisis general")
    return GeneralAnalysisResponse(summary=summary)

# --------------------------------------------------
# 4) /controls-analysis (extracción robusta de JSON)
# --------------------------------------------------
@app.post("/controls-analysis", response_model=ControlsResponse)
async def controls_analysis(req: ControlsRequest):
    logger.info("Received controls analysis request: %s", req.dict())

    pois_text = "\n".join(f"- {p.name} (types: {', '.join(p.types)})" for p in req.pois)
    prompt = (
        "Eres un experto en seguridad y controles.\n"
        "Con base en estos POIs y (opcionalmente) una imagen en base64:\n"
        f"{pois_text}\n"
        + ("Se incluye imagen en base64.\n" if req.image_base64 else "")
        + "Devuelve **solo** un JSON con esta forma:\n"
        "```json\n"
        "{ \"controles_recomendados\": [ { \"nombre\": \"...\", \"tipo\": \"...\" }, ... ] }\n"
        "```\n"
    )
    logger.debug("Prompt to LLM:\n%s", prompt)

    try:
        resp = client.chat.completions.create(
            model="Llama-4-Maverick-17B-128E-Instruct",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
            top_p=0.9,
        )
        raw = resp.choices[0].message.content
        logger.info("LLM controls output received (len=%d)", len(raw))
    except Exception as e:
        logger.error("Error calling LLM for controls: %s", e)
        raise HTTPException(status_code=500, detail="Error en LLM controles")

    # Extracción robusta del JSON
    start = raw.find("{")
    end   = raw.rfind("}")
    if start == -1 or end == -1 or start >= end:
        logger.error("No se encontró un bloque JSON válido en la respuesta del LLM")
        logger.debug("LLM raw output:\n%s", raw)
        raise HTTPException(status_code=500, detail="Formato de respuesta inválido del LLM")

    json_str = raw[start : end + 1]
    logger.debug("Extracted JSON fragment:\n%s", json_str)

    # Parsear
    try:
        parsed = json.loads(json_str)
    except Exception as e:
        logger.error("Error parsing controls JSON: %s", e)
        logger.error("Bad JSON fragment was:\n%s", json_str)
        raise HTTPException(status_code=500, detail="Error parsing JSON controles")

    # Extraer nombres
    lista = parsed.get("controles_recomendados") or parsed.get("controles") or []
    controles = []
    for item in lista:
        if isinstance(item, dict) and "nombre" in item:
            controles.append(item["nombre"])
        elif isinstance(item, str):
            controles.append(item)
        else:
            controles.append(str(item))

    logger.info("Returning controles: %s", controles)
    return ControlsResponse(controles=controles)