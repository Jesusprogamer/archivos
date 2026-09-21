#!/usr/bin/env python3
"""
Builds the tiny ONNX model the tests use in place of real segmentation weights.

It takes the same input a real matting model takes — 1x3xNxN, normalised — and
returns 1x1xNxN by slicing out the red channel. That is enough to exercise the
whole pipeline (preprocess, session, postprocess, mask upsampling) offline, and
it gives the end-to-end test a prediction it can actually assert on: run it over
the green-screen fixture and the red square must survive while the green
background is cut away.

Real weights are never committed; see PLAN.md section 5.
"""
import sys
import onnx
from onnx import TensorProto, helper, numpy_helper
import numpy as np

SIZE = 320


def build() -> onnx.ModelProto:
    inp = helper.make_tensor_value_info("input", TensorProto.FLOAT, [1, 3, SIZE, SIZE])
    out = helper.make_tensor_value_info("output", TensorProto.FLOAT, [1, 1, SIZE, SIZE])

    starts = numpy_helper.from_array(np.array([0], dtype=np.int64), "starts")
    ends = numpy_helper.from_array(np.array([1], dtype=np.int64), "ends")
    axes = numpy_helper.from_array(np.array([1], dtype=np.int64), "axes")

    node = helper.make_node("Slice", ["input", "starts", "ends", "axes"], ["output"])
    graph = helper.make_graph([node], "red-channel", [inp], [out], [starts, ends, axes])
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 13)])
    model.ir_version = 9
    onnx.checker.check_model(model)
    return model


if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else "tests/fixtures/test-model.onnx"
    onnx.save(build(), target)
    print(f"wrote {target}")
