"use client";

import type React from "react";
import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  GoogleMap,
  useJsApiLoader,
  Marker,
  Circle,
  InfoWindow,
} from "@react-google-maps/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Oficina } from "@/types/oficina";
import type { google } from "google-maps";
import { FileText, Loader2, MapPin, Plus, Save } from "lucide-react";

// Extiende tu tipo POI para incluir color
export interface POI {
  id: string;
  nombre: string;
  tipo: string;
  subtipo?: string;
  lat: number;
  lng: number;
  color: string;
}

// Mapa de colores por tipo
const TYPE_COLOR: Record<string, string> = {
  PR: "#ef4444",           // rojo
  PN: "#facc15",           // amarillo
  PA: "#22c55e",           // verde
  inundacion: "#60a5fa",   // azul
  deslizamiento: "#d97706",// ámbar
  Va: "#a855f7",           // morado
  Ve: "#10b981",           // verde esmeralda
  Aglom: "#374151",        // gris oscuro
};

const containerStyle = { width: "100%", height: "70vh" };
const libraries: ("places" | "drawing" | "geometry" | "visualization")[] = [
  "places",
  "drawing",
  "geometry",
];

export function MapaPerimetral({ id }: { id: string }) {
  const { isLoaded } = useJsApiLoader({
    id: "google-map-script",
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "",
    libraries,
  });

  const [oficina, setOficina] = useState<Oficina | null>(null);
  const [center, setCenter] = useState<google.maps.LatLngLiteral>({
    lat: -16.5,
    lng: -68.15,
  });

  const [markerPosition, setMarkerPosition] =
    useState<google.maps.LatLngLiteral | null>(null);
  const [pois, setPois] = useState<POI[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedPoi, setSelectedPoi] = useState<POI | null>(null);
  const [activeTab, setActiveTab] = useState("mapa");
  const [nuevoPoi, setNuevoPoi] = useState<Partial<POI>>({
    tipo: "PR",
    nombre: "",
    lat: 0,
    lng: 0,
    color: TYPE_COLOR["PR"],
  });
  const mapRef = useRef<google.maps.Map | null>(null);
  const router = useRouter();

  // Función para asignar color según tipo
  const getColorForType = (tipo: string) =>
    TYPE_COLOR[tipo] || "#6b7280"; // gris por defecto

  // Carga oficina y POIs previos
  useEffect(() => {
    const raw = localStorage.getItem("oficinas");
    if (!raw) return;
    const oficinas: Oficina[] = JSON.parse(raw);
    const off = oficinas.find((o) => o.id === id);
    if (!off) return;
    setOficina(off);
    if (off.lat != null && off.lng != null) {
      const pos = { lat: off.lat, lng: off.lng };
      setCenter(pos);
      setMarkerPosition(pos);
    }
    if (off.pois) {
      // Añadir color a cada POI guardado
      const loaded = off.pois.map((p: any) => ({
        ...p,
        color: p.color || getColorForType(p.tipo),
      }));
      setPois(loaded);
    }
  }, [id]);

  const onMapLoad = useCallback((map: google.maps.Map) => {
    mapRef.current = map;
  }, []);

  const handleMapClick = (e: google.maps.MapMouseEvent) => {
    if (!e.latLng) return;
    const pos = { lat: e.latLng.lat(), lng: e.latLng.lng() };
    if (activeTab === "mapa") {
      setMarkerPosition(pos);
    } else {
      setNuevoPoi((p) => ({ ...p, lat: pos.lat, lng: pos.lng }));
    }
  };

  const handleMarkerDragEnd = (e: google.maps.MapMouseEvent) => {
    if (e.latLng) {
      setMarkerPosition({ lat: e.latLng.lat(), lng: e.latLng.lng() });
    }
  };

  const handleGuardarUbicacion = () => {
    if (!markerPosition || !oficina) return;
    const raw = localStorage.getItem("oficinas");
    if (!raw) return;
    const arr: Oficina[] = JSON.parse(raw);
    const updated = arr.map((o) =>
      o.id === id
        ? { ...o, lat: markerPosition.lat, lng: markerPosition.lng }
        : o
    );
    localStorage.setItem("oficinas", JSON.stringify(updated));
    setOficina({ ...oficina, lat: markerPosition.lat, lng: markerPosition.lng });
  };

  const handleCargarPOIs = async () => {
    if (!markerPosition || !mapRef.current) return;
    setIsLoading(true);
    const service = new google.maps.places.PlacesService(mapRef.current);

    service.nearbySearch(
      { location: markerPosition, radius: 200 },
      async (results, status) => {
        if (
          status !== google.maps.places.PlacesServiceStatus.OK ||
          !results
        ) {
          console.error("PlacesService error", status);
          setIsLoading(false);
          return;
        }

        // Raw POIs sin clasificar
        const rawPois = results.map((r) => ({
          id: r.place_id!,
          nombre: r.name || "Sin nombre",
          lat: r.geometry!.location!.lat(),
          lng: r.geometry!.location!.lng(),
          tipo: "PN",
          color: TYPE_COLOR["PN"],
        }));

        // Llamada a backend /classify si lo deseas...
        // Aquí los convertimos en POIs con color asignado
        const classified: POI[] = rawPois.map((p) => ({
          ...p,
          // si backend nos devolviera p.tipo actualizado, usar:
          // tipo: c.tipo,
          color: getColorForType(p.tipo),
        }));

        setPois(classified);

        // Persistir en localStorage
        if (oficina) {
          const raw2 = localStorage.getItem("oficinas");
          if (raw2) {
            const arr2: Oficina[] = JSON.parse(raw2);
            const upd2 = arr2.map((o) =>
              o.id === id ? { ...o, pois: classified } : o
            );
            localStorage.setItem("oficinas", JSON.stringify(upd2));
          }
        }
        setIsLoading(false);
      }
    );
  };

  const handlePoiClick = (poi: POI) => setSelectedPoi(poi);
  const handleCloseInfoWindow = () => setSelectedPoi(null);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setNuevoPoi((p) => ({
      ...p,
      [name]: value,
    }));
  };

  const handleAgregarPoi = () => {
    if (
      !nuevoPoi.lat ||
      !nuevoPoi.lng ||
      !nuevoPoi.nombre ||
      !nuevoPoi.tipo ||
      !nuevoPoi.color
    )
      return;

    const newPoi: POI = {
      id: Date.now().toString(),
      tipo: nuevoPoi.tipo!,
      subtipo: nuevoPoi.subtipo,
      nombre: nuevoPoi.nombre!,
      lat: nuevoPoi.lat!,
      lng: nuevoPoi.lng!,
      color: nuevoPoi.color!,
    };

    const updatedPois = [...pois, newPoi];
    setPois(updatedPois);

    // Guardar en localStorage
    if (oficina) {
      const stored = localStorage.getItem("oficinas");
      if (stored) {
        const oficinas: Oficina[] = JSON.parse(stored);
        const updated = oficinas.map((o) =>
          o.id === id ? { ...o, pois: updatedPois } : o
        );
        localStorage.setItem("oficinas", JSON.stringify(updated));
      }
    }

    setNuevoPoi({
      tipo: "PR",
      nombre: "",
      lat: 0,
      lng: 0,
      color: TYPE_COLOR["PR"],
    });
  };

  const navigateToInforme = () => {
    router.push(`/informe/${id}`);
  };

  const calcularDistancia = (
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number
  ) => {
    const R = 6371e3;
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lng2 - lng1) * Math.PI) / 180;
    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) *
      Math.cos(φ2) *
      Math.sin(Δλ / 2) *
      Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  if (!isLoaded)
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
        <span className="ml-2">Cargando mapa...</span>
      </div>
    );

  return (
    <div className="container mx-auto py-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">
          Mapa Perimetral: {oficina?.nombre || "Cargando..."}
        </h1>
        <Button
          onClick={navigateToInforme}
          disabled={!markerPosition || pois.length === 0}
        >
          <FileText className="mr-2 h-4 w-4" />
          Ver Informe
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="mapa">Ubicación de Oficina</TabsTrigger>
          <TabsTrigger value="pois" disabled={!markerPosition}>
            Puntos de Interés
          </TabsTrigger>
        </TabsList>

        {/* --- TAB "MAPA" --- */}
        <TabsContent value="mapa">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <Card>
                <CardHeader>
                  <CardTitle>Seleccione la ubicación</CardTitle>
                </CardHeader>
                <CardContent>
                  <GoogleMap
                    mapContainerStyle={containerStyle}
                    center={center}
                    zoom={13}
                    onClick={handleMapClick}
                    onLoad={onMapLoad}
                  >
                    {markerPosition && (
                      <>
                        <Marker
                          position={markerPosition}
                          draggable
                          onDragEnd={handleMarkerDragEnd}
                        />
                        <Circle
                          center={markerPosition}
                          radius={200}
                          options={{
                            fillColor: "rgba(66, 133, 244, 0.2)",
                            strokeColor: "rgba(66, 133, 244, 0.8)",
                            strokeWeight: 2,
                          }}
                        />
                      </>
                    )}
                  </GoogleMap>
                </CardContent>
              </Card>
            </div>
            <div>
              <Card>
                <CardHeader>
                  <CardTitle>Información de Ubicación</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div>
                      <Label>Coordenadas</Label>
                      {markerPosition ? (
                        <div className="grid grid-cols-2 gap-2 mt-1">
                          <div>
                            <strong>Latitud:</strong>{" "}
                            {markerPosition.lat.toFixed(6)}
                          </div>
                          <div>
                            <strong>Longitud:</strong>{" "}
                            {markerPosition.lng.toFixed(6)}
                          </div>
                        </div>
                      ) : (
                        <p className="text-muted-foreground mt-1">
                          Haga clic en el mapa...
                        </p>
                      )}
                    </div>
                    <div>
                      <strong>Radio de Influencia:</strong> 200 metros
                    </div>
                    <Button
                      onClick={handleGuardarUbicacion}
                      disabled={!markerPosition}
                      className="w-full mt-4"
                    >
                      <Save className="mr-2 h-4 w-4" />
                      Guardar Ubicación
                    </Button>
                    <Button
                      onClick={handleCargarPOIs}
                      disabled={!markerPosition}
                      variant="outline"
                      className="w-full mt-2"
                    >
                      {isLoading ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Cargando...
                        </>
                      ) : (
                        <>
                          <MapPin className="mr-2 h-4 w-4" />
                          Cargar POIs
                        </>
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* --- TAB "POIS" --- */}
        <TabsContent value="pois">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <Card>
                <CardHeader>
                  <CardTitle>Puntos de Interés</CardTitle>
                </CardHeader>
                <CardContent>
                  <GoogleMap
                    mapContainerStyle={containerStyle}
                    center={markerPosition || center}
                    zoom={13}
                    onClick={handleMapClick}
                    onLoad={onMapLoad}
                  >
                    {markerPosition && (
                      <>
                        <Marker
                          position={markerPosition}
                          icon={{
                            url:
                              "https://maps.google.com/mapfiles/ms/icons/blue-dot.png",
                          }}
                        />
                        <Circle
                          center={markerPosition}
                          radius={200}
                          options={{
                            fillColor: "rgba(66, 133, 244, 0.2)",
                            strokeColor: "rgba(66, 133, 244, 0.8)",
                            strokeWeight: 2,
                          }}
                        />
                      </>
                    )}

                    {pois.map((poi) => (
                      <Marker
                        key={poi.id}
                        position={{ lat: poi.lat, lng: poi.lng }}
                        icon={{
                          path: google.maps.SymbolPath.CIRCLE,
                          fillColor: poi.color,
                          fillOpacity: 1,
                          strokeColor: poi.color,
                          strokeWeight: 2,
                          scale: 6,
                        }}
                        onClick={() => handlePoiClick(poi)}
                      />
                    ))}

                    {selectedPoi && (
                      <InfoWindow
                        position={{
                          lat: selectedPoi.lat,
                          lng: selectedPoi.lng,
                        }}
                        onCloseClick={handleCloseInfoWindow}
                      >
                        <div className="p-2">
                          <h3 className="font-bold">{selectedPoi.nombre}</h3>
                          <p className="text-sm">
                            Tipo: {selectedPoi.tipo}{" "}
                            {selectedPoi.subtipo
                              ? `(${selectedPoi.subtipo})`
                              : ""}
                          </p>
                          {markerPosition && (
                            <p className="text-sm">
                              Distancia:{" "}
                              {calcularDistancia(
                                markerPosition.lat,
                                markerPosition.lng,
                                selectedPoi.lat,
                                selectedPoi.lng
                              ).toFixed(0)}{" "}
                              m
                            </p>
                          )}
                        </div>
                      </InfoWindow>
                    )}
                  </GoogleMap>
                </CardContent>
              </Card>
            </div>

            <div>
              {/* Formulario manual */}
              <Card className="mb-6">
                <CardHeader>
                  <CardTitle>Agregar POI Manual</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="nombre">Nombre</Label>
                      <Input
                        id="nombre"
                        name="nombre"
                        value={nuevoPoi.nombre}
                        onChange={handleInputChange}
                        placeholder="Ej: Gasolinera"
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label htmlFor="tipo">Tipo (abreviatura)</Label>
                      <Input
                        id="tipo"
                        name="tipo"
                        value={nuevoPoi.tipo}
                        onChange={handleInputChange}
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label htmlFor="color">Color</Label>
                      <input
                        id="color"
                        name="color"
                        type="color"
                        value={nuevoPoi.color}
                        onChange={handleInputChange}
                        className="mt-1 h-8 w-16 p-0 border-0"
                      />
                    </div>
                    <div>
                      <Label>Coordenadas</Label>
                      {nuevoPoi.lat && nuevoPoi.lng ? (
                        <div className="grid grid-cols-2 gap-2 mt-1">
                          <div>
                            <strong>Lat:</strong>{" "}
                            {nuevoPoi.lat.toFixed(6)}
                          </div>
                          <div>
                            <strong>Lng:</strong>{" "}
                            {nuevoPoi.lng.toFixed(6)}
                          </div>
                        </div>
                      ) : (
                        <p className="text-muted-foreground mt-1">
                          Clic en el mapa para seleccionar...
                        </p>
                      )}
                    </div>
                    <Button
                      onClick={handleAgregarPoi}
                      disabled={
                        !nuevoPoi.nombre ||
                        !nuevoPoi.lat ||
                        !nuevoPoi.lng
                      }
                      className="w-full"
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      Agregar
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Leyenda */}
              <Card>
                <CardHeader>
                  <CardTitle>Leyenda</CardTitle>
                </CardHeader>
                <CardContent>
                  <table className="w-full text-sm">
                    <thead>
                      <tr>
                        <th className="px-2 text-left">Color</th>
                        <th className="px-2 text-left">Código</th>
                        <th className="px-2 text-left">Significado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(TYPE_COLOR).map(
                        ([code, color]) => (
                          <tr key={code}>
                            <td className="px-2 py-1">
                              <span
                                className="inline-block w-4 h-4 rounded"
                                style={{ background: color }}
                              ></span>
                            </td>
                            <td className="px-2 py-1">{code}</td>
                            <td className="px-2 py-1">
                              {{
                                PR: "Punto de Riesgo",
                                PN: "Punto Neutro",
                                PA: "Punto de Apoyo",
                                inundacion: "Zona Inundación",
                                deslizamiento: "Zona Deslizamiento",
                                Va: "Vialidad Acceso",
                                Ve: "Vialidad Egreso",
                                Aglom: "Aglomeración",
                              }[code] || ""}
                            </td>
                          </tr>
                        )
                      )}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
