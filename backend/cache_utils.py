# Simple cache utilities that work with session state and configurations only
# Removed temp-cache directory functionality

import logging


def save_to_cache(pipeline_name, obj, filename):
    """Dummy function - temp-cache functionality removed"""
    logging.info(f"Cache save ignored for {pipeline_name}/{filename} (temp-cache disabled)")
    pass


def load_from_cache(pipeline_name, filename):
    """Dummy function - temp-cache functionality removed"""
    logging.info(f"Cache load ignored for {pipeline_name}/{filename} (temp-cache disabled)")
    return None


def exists_in_cache(pipeline_name, filename):
    """Dummy function - temp-cache functionality removed"""
    return False


if __name__ == "__main__":
    print("Testing dummy cache functions...")
    save_to_cache('test', {'data': 'test'}, 'test.pkl')
    result = load_from_cache('test', 'test.pkl')  
    exists = exists_in_cache('test', 'test.pkl')
    print(f'Cache functions work: save=None, load={result}, exists={exists}')
    print("Cache utilities functioning correctly (all disabled)")
