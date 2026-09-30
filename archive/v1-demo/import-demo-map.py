"""OSM XMLから試し歩きの歩道と目的地を再生成する。ネットワーク通信は行わない。

使用例: python3 scripts/import-demo-map.py /path/to/map.osm
元データ: https://api.openstreetmap.org/api/0.6/map?bbox=139.570,35.696,139.580,35.702
"""

import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

root = ET.parse(sys.argv[1]).getroot()
coordinates = {
    node.attrib["id"]: [float(node.attrib["lon"]), float(node.attrib["lat"])]
    for node in root.findall("node")
}
graph = {}
for way in root.findall("way"):
    tags = {tag.attrib["k"]: tag.attrib["v"] for tag in way.findall("tag")}
    if tags.get("highway") not in ("footway", "path", "pedestrian", "steps"):
        continue
    if tags.get("access") in ("no", "private"):
        continue
    ids = [node.attrib["ref"] for node in way.findall("nd") if node.attrib["ref"] in coordinates]
    for a, b in zip(ids, ids[1:]):
        graph.setdefault(a, set()).add(b)
        graph.setdefault(b, set()).add(a)

remaining = set(graph)
components = []
while remaining:
    stack = [remaining.pop()]
    component = set(stack)
    while stack:
        for neighbor in graph[stack.pop()]:
            if neighbor in remaining:
                remaining.remove(neighbor)
                component.add(neighbor)
                stack.append(neighbor)
    components.append(component)

component = max(components, key=len)
data = {
    node: {"coordinate": coordinates[node], "neighbors": sorted(graph[node] & component)}
    for node in sorted(component)
}
targets = [
    [139.57613, 35.70065], [139.57538, 35.69997], [139.57365, 35.70012],
    [139.57266, 35.69867], [139.57672, 35.69885], [139.57459, 35.69825],
    [139.57684, 35.70070], [139.5715, 35.7003], [139.573, 35.697],
    [139.5780, 35.7000], [139.5738, 35.6979], [139.572, 35.6998],
    [139.5773, 35.6998],
]


def square_distance(a, b):
    return ((a[0] - b[0]) * 0.81) ** 2 + (a[1] - b[1]) ** 2


points = [
    coordinates[min(sorted(component), key=lambda node: square_distance(target, coordinates[node]))]
    for target in targets
]
destination = Path(__file__).resolve().parent.parent / "src"
for filename, value in [("demo-paths.json", data), ("demo-points.json", points)]:
    (destination / filename).write_text(json.dumps(value, separators=(",", ":")), encoding="utf-8")
print(f"{len(data)} nodes / {len(points) - 1} destinations")
