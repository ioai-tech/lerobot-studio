"""Run the selected v0.6.1 compute_stats.py definitions as a JSON oracle."""

from __future__ import annotations

import ast
import json
import os
import sys
from pathlib import Path

import numpy as np

SOURCE = Path(
    os.environ.get(
        "LEROBOT_V061_COMPUTE_STATS",
        "/tmp/lerobot-official-v061/src/lerobot/datasets/compute_stats.py",
    )
)

tree = ast.parse(SOURCE.read_text())
selected = []
for node in tree.body:
    if isinstance(node, ast.Assign) and any(
        isinstance(target, ast.Name) and target.id == "DEFAULT_QUANTILES" for target in node.targets
    ):
        selected.append(node)
    elif isinstance(node, ast.ClassDef) and node.name == "RunningQuantileStats":
        selected.append(node)
    elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and (
        node.name.startswith("_reshape")
        or node.name in {
            "_prepare_array_for_stats",
            "_compute_basic_stats",
            "get_feature_stats",
            "_validate_stat_value",
            "_assert_type_and_shape",
            "aggregate_feature_stats",
            "aggregate_stats",
        }
    ):
        selected.append(node)

namespace = {"np": np}
exec(compile(ast.Module(body=selected, type_ignores=[]), str(SOURCE), "exec"), namespace)

request = json.load(sys.stdin)
response = {}
for fixture_name, episodes in request.items():
    episode_stats = []
    for episode in episodes:
        array = np.asarray(episode, dtype=np.float32)
        stats = namespace["get_feature_stats"](
            array,
            axis=0,
            keepdims=array.ndim == 1,
        )
        episode_stats.append({"feature": stats})
    aggregate = namespace["aggregate_stats"](episode_stats)["feature"]
    response[fixture_name] = {key: value.tolist() for key, value in aggregate.items()}

json.dump(response, sys.stdout, allow_nan=False)
