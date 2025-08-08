# cache_utils.py

import os
import pickle

_cache_root_dir = "/home/fatemeh/matelda-demo/temp-cache"  # fallback default


def set_cache_dir(path):
    global _cache_root_dir
    _cache_root_dir = path


def save_to_cache(pipeline_name, obj, filename):
    pipeline_dir = os.path.join(_cache_root_dir, pipeline_name)
    os.makedirs(pipeline_dir, exist_ok=True)
    with open(os.path.join(pipeline_dir, filename), "wb") as f:
        pickle.dump(obj, f)


def load_from_cache(pipeline_name, filename):
    try:
        with open(os.path.join(_cache_root_dir, pipeline_name, filename), "rb") as f:
            return pickle.load(f)
    except FileNotFoundError:
        return None


def exists_in_cache(pipeline_name, filename):
    return os.path.exists(os.path.join(_cache_root_dir, pipeline_name, filename))
