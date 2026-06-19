const EARTH_RADIUS_M = 6371000;

function toRad(value) {
  return (Number(value) * Math.PI) / 180;
}

function distanceMeters(aLat, aLng, bLat, bLng) {
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const deltaLat = toRad(Number(bLat) - Number(aLat));
  const deltaLng = toRad(Number(bLng) - Number(aLng));

  const h =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;

  return Math.round(EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
}

function isInsideRadius(workerLat, workerLng, eventLat, eventLng, radiusMeters = 150) {
  const distance = distanceMeters(workerLat, workerLng, eventLat, eventLng);
  return { distance, inside: distance <= radiusMeters };
}

module.exports = {
  distanceMeters,
  isInsideRadius
};
