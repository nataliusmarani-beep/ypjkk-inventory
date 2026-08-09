import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

/**
 * Stop-progress map. Deliberately NOT a live GPS position — this app has no
 * tracker hardware (see the trip_events comment in backend/db.js, and
 * routes/track.js) because a live map would just stall on the SP2/SP3 signal
 * exactly when a parent needs it most.
 *
 * Instead: every TPS on the run is plotted, the segment the bus has already
 * covered is drawn solid, what's left is dashed, and a bus marker sits at
 * the stop it's presumed to be at/heading to right now — the same
 * "departed from stop X" trail ScannerPage and the parent banner already
 * use, drawn as a route instead of a list.
 */
export default function BusTrackMap({ stops, currentIndex }) {
  const elRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);

  const located = (stops || []).filter((s) => s.latitude != null && s.longitude != null);

  useEffect(() => {
    if (!elRef.current || mapRef.current) return;
    mapRef.current = L.map(elRef.current, { scrollWheelZoom: false });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(mapRef.current);
    return () => { mapRef.current?.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (layerRef.current) { layerRef.current.remove(); }
    const layer = L.layerGroup().addTo(map);
    layerRef.current = layer;

    if (located.length === 0) return;

    // The container is hidden (display: none) whenever there's nothing to
    // plot — Leaflet measures the container on init/interaction, so a map
    // that started hidden (or was hidden and is now reappearing) needs a
    // nudge to pick up its real size before fitBounds runs.
    map.invalidateSize();

    const latlngs = located.map((s) => [s.latitude, s.longitude]);

    // Segment already covered (solid, primary) vs still ahead (dashed, muted).
    // currentIndex counts against the FULL stops list; clamp it into the
    // located-only list since a stop with no coordinates just gets skipped
    // when drawing, not when counting progress.
    const coveredCount = Math.min(currentIndex ?? 0, located.length);
    const covered = latlngs.slice(0, Math.max(coveredCount, 1));
    const ahead = latlngs.slice(Math.max(coveredCount - 1, 0));

    if (covered.length > 1) {
      L.polyline(covered, { color: '#1a7a4c', weight: 4 }).addTo(layer);
    }
    if (ahead.length > 1) {
      L.polyline(ahead, { color: '#8a93a6', weight: 3, dashArray: '6 8' }).addTo(layer);
    }

    located.forEach((s, i) => {
      const departed = i < coveredCount;
      L.circleMarker([s.latitude, s.longitude], {
        radius: 7,
        color: departed ? '#1a7a4c' : '#8a93a6',
        fillColor: departed ? '#1a7a4c' : '#fff',
        fillOpacity: 1,
        weight: 2,
      })
        .addTo(layer)
        .bindPopup(`<strong>${s.stop_code} ${s.stop_name}</strong><br/>${
          departed ? `Sudah berangkat ${s.departed_at ? new Date(s.departed_at).toLocaleTimeString('id-ID') : ''}` : 'Belum dilewati'
        }`);
    });

    // Bus marker: at the current stop if still approaching it, otherwise at
    // the last located stop (leg effectively done, presumed heading back).
    const busAt = located[Math.min(currentIndex ?? 0, located.length - 1)];
    if (busAt) {
      L.marker([busAt.latitude, busAt.longitude], {
        icon: L.divIcon({
          className: 'bus-track-icon',
          html: '<span>🚌</span>',
          iconSize: [30, 30],
          iconAnchor: [15, 15],
        }),
        zIndexOffset: 1000,
      }).addTo(layer);
    }

    if (latlngs.length === 1) {
      map.setView(latlngs[0], 15);
    } else {
      map.fitBounds(L.latLngBounds(latlngs), { padding: [30, 30] });
    }
  }, [located, currentIndex]);

  // The map container stays mounted even with nothing to plot — Leaflet is
  // initialized against it once (see the empty-deps effect above), and an
  // elRef that's only sometimes in the tree would leave that init effect
  // permanently no-op'd the first time located.length happened to be 0 (its
  // deps never change, so it never gets a second chance at a real element).
  return (
    <>
      {located.length === 0 && (
        <div className="banner info">
          <span>🗺️</span>
          <div>
            Koordinat TPS untuk rute ini belum diatur. Progres bis tetap terlihat di daftar TPS
            di bawah — peta akan muncul setelah Tim Transportasi mengisi lokasi TPS.
          </div>
        </div>
      )}
      <div ref={elRef} style={{
        height: 320, borderRadius: 14, overflow: 'hidden',
        display: located.length === 0 ? 'none' : 'block',
      }} />
    </>
  );
}
