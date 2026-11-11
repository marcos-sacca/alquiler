# Tracker de alquileres (Zonaprop)

Vicente López, Martínez y Villa Adelina · departamentos y PH de 1 y 2 ambientes · tope $900.000 (alquiler + expensas).

```
node tracker.mjs          # baja los avisos (~6 min), actualiza data/listings.json y data.js
node tracker.mjs --test   # tests del parser y del puntaje
```

Después abrí `index.html` (doble clic). Se ordena por "% bajo mercado": cuánto más barato es el aviso (en $/m², o en total si no tiene m²)
que la mediana de avisos comparables: mismos ambientes y mismo barrio si hay al menos 5, si no toda la zona.

## Que corra solo

```powershell
powershell -ExecutionPolicy Bypass -File programar.ps1
```

Crea la tarea `TrackerAlquileres`: todos los días a las 12:00, o apenas prendas la PC si estaba apagada.
`data/listings.json` guarda el historial (primera vez visto, cambios de precio, avisos dados de baja).

## Límites conocidos

- Argenprop no está: su sitio exige un desafío anti-bots que un script no debe esquivar. Hoy se mira a mano.
- Zonaprop corta con 403 desde la página 10 de una búsqueda; por eso se piden 1 y 2 ambientes por separado y 2 amb. también "hasta $900.000".
- Avisos en dólares, sin precio, temporarios o con precio absurdo (< $200.000) no entran al ranking.
- Si el aviso no muestra expensas se lo marca "¿expensas?": el total real puede ser mayor.
- Para esto se usa `curl.exe` (viene con Windows) porque Cloudflare desafía al `fetch` de Node. Pide 1 página cada 4 s, 1 vez por día.
