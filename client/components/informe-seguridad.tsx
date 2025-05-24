"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowLeft, Download, Printer, UploadCloud } from "lucide-react";
import type { Oficina, POI } from "@/types/oficina";
import Image from "next/image";
import { MapaEstatico } from "@/components/mapa-estatico";

export function InformeSeguridad({ id }: { id: string }) {
  const [oficina, setOficina] = useState<Oficina | null>(null);
  const [mapCenter, setMapCenter] = useState<{ lat: number; lng: number }>({ lat: 0, lng: 0 });
  const [isLoading, setIsLoading] = useState(false);
  const [analisisIA, setAnalisisIA] = useState<{
    riesgoTotal: string;
    riesgoResidual: string;
    riesgoGeografico: string;
    controlesExistentes: string[];
  } | null>(null);
  const [generalAnalysis, setGeneralAnalysis] = useState<string>("");
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const router = useRouter();

  // 1) Carga datos de la oficina al montar
  useEffect(() => {
    const stored = localStorage.getItem("oficinas");
    if (!stored) return;
    const list: Oficina[] = JSON.parse(stored);
    const found = list.find((o) => o.id === id);
    if (!found) return;
    setOficina(found);

    // Actualiza centro del mapa
    if (found.lat != null && found.lng != null) {
      setMapCenter({ lat: found.lat, lng: found.lng });
    }

    // Análisis previo o nuevo
    if (!found.riesgoTotal || found.riesgoTotal === "Sin evaluar") {
      generarAnalisisIA(found);
    } else {
      setAnalisisIA({
        riesgoTotal: found.riesgoTotal!,
        riesgoResidual: found.riesgoResidual!,
        riesgoGeografico: found.riesgoGeografico!,
        controlesExistentes: found.controlesExistentes || [],
      });
    }
  }, [id]);

  // 2) Genera o recarga análisis IA de riesgos
  async function generarAnalisisIA(ofi: Oficina) {
    setIsLoading(true);

    // Reconstruir payload de POIs
    const payloadPois = (ofi.pois ?? []).map((p) => ({
      id: p.id,
      name: (p as any).nombre ?? (p as any).name,
      types: (p as any).types ?? [(p as any).tipo ?? "PN"],
      lat: p.lat,
      lng: p.lng,
    }));

    try {
      const res = await fetch("http://localhost:8000/analyze-risk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          center: { lat: ofi.lat, lng: ofi.lng },
          pois: payloadPois,
          map_image_url: null,
        }),
      });
      if (!res.ok) throw new Error("422");
      const data = await res.json();
      setAnalisisIA(data);
      updateOficina({ ...ofi, ...data });
    } catch {
      console.error("Error en analyze-risk, usando simulación");
      const poisForSim = payloadPois.map((p) => ({
        ...p,
        tipo: p.types[0],
        nombre: p.name,
      }));
      const data = generarAnalisisSimulado(poisForSim);
      setAnalisisIA(data);
      updateOficina({ ...ofi, ...data });
    } finally {
      setIsLoading(false);
    }
  }

  // 3) Simulación de análisis
  function generarAnalisisSimulado(pois: POI[]) {
    const countPR = pois.filter((p) => p.tipo === "PR").length;
    const countPA = pois.filter((p) => p.tipo === "PA").length;
    let riesgoTotal = "Medio";
    if (countPR > 3) riesgoTotal = "Alto";
    else if (countPR <= 1 && countPA > 2) riesgoTotal = "Bajo";
    const riesgoResidual = riesgoTotal === "Alto" ? "Medio" : "Bajo";
    const riesgoGeografico =
      countPR > countPA ? "A" : countPR === countPA ? "I" : "D";
    const controlesExistentes = [
      "Sistema de vigilancia CCTV",
      "Control de acceso biométrico",
      "Guardias de seguridad 24/7",
      "Protocolo de evacuación",
      "Sistema contra incendios",
    ];
    return { riesgoTotal, riesgoResidual, riesgoGeografico, controlesExistentes };
  }

  // 4) Actualiza localStorage con nuevos datos
  function updateOficina(updated: Oficina) {
    const stored = localStorage.getItem("oficinas")!;
    const list: Oficina[] = JSON.parse(stored);
    const next = list.map((o) => (o.id === updated.id ? updated : o));
    localStorage.setItem("oficinas", JSON.stringify(next));
    // También ajustamos centro si cambió
    if (updated.lat != null && updated.lng != null) {
      setMapCenter({ lat: updated.lat, lng: updated.lng });
    }
  }

  // 5) Subida de imagen
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    if (!file) {
      setPreviewSrc(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setPreviewSrc(reader.result as string);
    reader.readAsDataURL(file);
  };

  // 6) Análisis general + controles con LLM
  const handleGeneralAnalysis = async () => {
    if (!oficina) return;
    setIsLoading(true);

    const payloadPois = (oficina.pois ?? []).map((p) => ({
      id: p.id,
      name: (p as any).nombre,
      types: (p as any).types ?? [(p as any).tipo ?? "PN"],
      lat: p.lat,
      lng: p.lng,
    }));

    try {
      // Resumen general
      const genRes = await fetch("http://localhost:8000/general-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          descripcion: oficina.nombre,
          pois: payloadPois,
          image_base64: previewSrc,
        }),
      });
      const { summary } = await genRes.json();
      setGeneralAnalysis(summary);

      // Controles recomendados
      const ctrlRes = await fetch("http://localhost:8000/controls-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pois: payloadPois,
          image_base64: previewSrc,
        }),
      });
      const { controles } = await ctrlRes.json();
      setAnalisisIA((prev) =>
        prev ? { ...prev, controlesExistentes: controles } : prev
      );
    } catch (e) {
      console.error("Error análisis LLM:", e);
      setGeneralAnalysis("Error al generar análisis.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleVolver = () => router.back();
  const handleImprimir = () => window.print();

  if (!oficina) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
        <span className="ml-2">Cargando datos...</span>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6">
      {/* Header */}
      <div className="flex justify-between items-center mb-6 print:hidden">
        <Button variant="outline" onClick={handleVolver}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Volver
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleImprimir}>
            <Printer className="mr-2 h-4 w-4" /> Imprimir
          </Button>
          <Button variant="outline">
            <Download className="mr-2 h-4 w-4" /> Exportar PDF
          </Button>
        </div>
      </div>

      {/* Título */}
      <div className="bg-gray-800 text-white p-4 mb-6 print:mb-2">
        <h1 className="text-2xl font-bold text-center">
          REPORTE DE EVALUACIÓN SEGURIDAD PERIMETRAL
        </h1>
      </div>

      {/* Información general de oficina */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 print:gap-2">
        <div className="md:col-span-2 bg-green-100 p-4 rounded print:rounded-none">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2"><strong>Nombre:</strong> {oficina.nombre}</div>
            <div className="col-span-2"><strong>Dirección:</strong> {oficina.direccion}</div>
            <div className="col-span-2">
              <strong>Ubicación:</strong> {oficina.lat.toFixed(6)}, {oficina.lng.toFixed(6)}
            </div>
            <div><strong>Depto.:</strong> {oficina.departamento}</div>
            <div><strong>Ciudad:</strong> {oficina.ciudad}</div>
            <div><strong>Zona:</strong> {oficina.zona}</div>
            <div><strong>Aforo personas:</strong> {oficina.aforo}</div>
            <div className="col-span-2">
              <strong>Instalaciones:</strong> {oficina.instalaciones}
            </div>
          </div>
        </div>

        {/* Leyenda y riesgo geográfico */}
        <div className="border border-gray-300 p-4 rounded print:rounded-none">
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="flex items-center"><strong>PR =</strong> <span className="w-4 h-4 bg-red-500 ml-2 rounded-full"></span></div>
            <div><strong>RGeograf =</strong> {analisisIA?.riesgoGeografico || "N/A"}</div>
            <div className="flex items-center"><strong>PN =</strong> <span className="w-4 h-4 bg-yellow-400 ml-2"></span></div>
            <div className="flex items-center"><strong>Inund =</strong> <span className="w-4 h-4 bg-blue-300 ml-2"></span></div>
            <div className="flex items-center"><strong>PA =</strong> <span className="w-4 h-4 bg-green-500 ml-2 rounded-full"></span></div>
            <div className="flex items-center"><strong>Desl =</strong> <span className="w-4 h-4 bg-amber-700 ml-2"></span></div>
            <div className="flex items-center"><strong>Va =</strong> <span className="w-4 h-4 bg-purple-500 ml-2"></span></div>
            <div className="flex items-center"><strong>Aglom =</strong> <span className="w-4 h-4 bg-gray-800 ml-2 flex items-center justify-center text-white text-xs">👥</span></div>
            <div className="flex items-center"><strong>Ve =</strong> <span className="w-4 h-4 bg-emerald-500 ml-2 flex items-center justify-center text-white text-xs">→</span></div>
          </div>
        </div>
      </div>

      {/* Procesos críticos, servicios y riesgos */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-6 print:mt-2 print:gap-2">
        <div className="bg-yellow-300 p-4 rounded print:rounded-none">
          <h2 className="font-bold text-center mb-2">PROCESOS CRÍTICOS</h2>
          <ul className="list-disc list-inside text-sm">
            <li>Atención al cliente</li>
            <li>Gestión de documentos</li>
            <li>Operaciones financieras</li>
            <li>Seguridad de la información</li>
            <li>Comunicaciones</li>
          </ul>
        </div>
        <div className="bg-yellow-300 p-4 rounded print:rounded-none">
          <h2 className="font-bold text-center mb-2">SERVICIOS & PRODUCTOS</h2>
          <ul className="list-disc list-inside text-sm">
            <li>Atención personalizada</li>
            <li>Asesoría financiera</li>
            <li>Gestión de cuentas</li>
            <li>Préstamos y créditos</li>
            <li>Servicios digitales</li>
          </ul>
        </div>
        <div className="border border-gray-300 p-4 rounded print:rounded-none">
          <div className="bg-red-500 text-white p-2 text-center mb-2">
            <h2 className="font-bold">RIESGO ZC:</h2>
            <p>{analisisIA?.riesgoTotal || "Sin evaluar"}</p>
          </div>
          <div className="bg-green-500 text-white p-2 text-center">
            <h2 className="font-bold">RIESGO RESIDUAL ZC:</h2>
            <p>{analisisIA?.riesgoResidual || "Sin evaluar"}</p>
          </div>
        </div>
      </div>

      {/* Mapa de puntos detectados */}
      <div className="mt-6 print:mt-2">
        <h2 className="font-bold mb-2">MAPA DE PUNTOS DETECTADOS</h2>
        <div className="w-full h-[600px] rounded border overflow-hidden">
          <MapaEstatico center={mapCenter} pois={oficina.pois ?? []} />
        </div>
      </div>
      {/* Subir imagen y ejecutar análisis general + controles */}
      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <h2 className="font-bold mb-2">Subir Imagen</h2>
          <input id="file-input" type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
          <label htmlFor="file-input" className="inline-flex items-center px-4 py-2 bg-blue-500 text-white rounded cursor-pointer">
            <UploadCloud className="mr-2 h-4 w-4" /> Seleccionar Imagen
          </label>
          {previewSrc && (
            <div className="mt-4">
              <Image src={previewSrc} alt="Preview" width={400} height={200} className="object-cover rounded" />
              <Button className="mt-2" onClick={handleGeneralAnalysis}>
                Analizar con LLM
              </Button>
            </div>
          )}
        </div>
        <div>
          {isLoading ? (
            <div className="flex items-center mt-6">
              <Loader2 className="animate-spin mr-2" /> Analizando...
            </div>
          ) : (
            analisisIA && (
              <div className="space-y-4">
                {/* General summary */}
                <div>
                  <h2 className="font-bold">Análisis General:</h2>
                  <p>{generalAnalysis || "No hay análisis aún."}</p>
                </div>
                {/* Riesgos */}
                <div className="bg-red-500 text-white p-2 rounded">
                  <h3 className="font-bold">RIESGO ZC:</h3>
                  <p>{analisisIA.riesgoTotal}</p>
                </div>
                <div className="bg-green-500 text-white p-2 rounded">
                  <h3 className="font-bold">RIESGO RESIDUAL ZC:</h3>
                  <p>{analisisIA.riesgoResidual}</p>
                </div>
                {/* Controles */}
                <div>
                  <h3 className="font-bold">Controles Existentes:</h3>
                  <ul className="list-disc list-inside">
                    {analisisIA.controlesExistentes.map((c, i) => <li key={i}>{c}</li>)}
                  </ul>
                </div>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  )
}