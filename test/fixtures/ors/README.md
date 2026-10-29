Hand-written ORS responses (no key existed when these were made), shaped after the documented return types:
- `directions.json`: POST /v2/directions/driving-car/geojson for Nomadic Beerworks → The Yard → Pinthouse Brewing
  (Austin). GeoJSON FeatureCollection; `properties.segments[]` one per consecutive waypoint pair, `distance` in
  meters, `duration` in seconds; `summary` totals; `way_points` indexes into the geometry.
- `matrix.json`: POST /v2/matrix/driving-car with metrics duration+distance for the same 3 points: `durations`
  (seconds) and `distances` (meters), rows = sources, columns = destinations; one unroutable cell is `null`.
- `geocode.json`: GET /geocode/search (Pelias) for "E Cesar Chavez St, Austin": FeatureCollection of Points
  `[lon, lat]` with `properties.label`.
- `quota.json`: the 403 body ORS's gateway sends when the daily quota is spent.
Numbers are plausible, not measured. Replace with recorded answers once the key exists.
