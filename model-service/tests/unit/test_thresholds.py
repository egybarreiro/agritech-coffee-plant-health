"""Threshold rules — pure logic, no TensorFlow.

Contract (from the training specs): a class fires when
probability >= its threshold, evaluated in the declared class order.
"""
from __future__ import annotations

import pytest

from app.inference import CLASS_ORDER, THRESHOLDS, apply_thresholds


def _probs(**overrides) -> dict[str, float]:
    base = {"miner": 0.0, "rust": 0.0, "phoma": 0.0, "cercospora": 0.0}
    base.update(overrides)
    return base


def test_all_below_thresholds_fires_nothing():
    assert apply_thresholds(_probs(miner=0.49, rust=0.64, phoma=0.09, cercospora=0.29)) == []


def test_boundary_probabilities_fire_inclusively():
    # Exactly at threshold counts as fired (>=, per spec).
    assert apply_thresholds(_probs(miner=0.50, rust=0.65, phoma=0.10, cercospora=0.30)) == [
        "miner", "rust", "phoma", "cercospora"
    ]


def test_results_are_in_declared_order():
    fired = apply_thresholds(_probs(cercospora=0.44, phoma=0.99, rust=0.90))
    assert fired == ["rust", "phoma", "cercospora"]
    assert fired == [name for name in CLASS_ORDER if name in fired]


def test_healthy_is_always_no_fire():
    healthy = _probs(miner=0.01, rust=0.02, phoma=0.003, cercospora=0.04)
    assert apply_thresholds(healthy) == []


def test_declared_thresholds_match_the_trained_specs():
    # Guards against accidental reordering/retyping of the training constants.
    assert THRESHOLDS == {"miner": 0.50, "rust": 0.65, "phoma": 0.10, "cercospora": 0.30}
    assert CLASS_ORDER == ("miner", "rust", "phoma", "cercospora")
