import numpy as np
import pandas as pd

# Debug the hospital data issue
clean_df = pd.read_csv(
    "/home/fatemeh/matelda-demo/Matelda-Demo/datasets/QRM/hospital/clean.csv"
)
dirty_df = pd.read_csv(
    "/home/fatemeh/matelda-demo/Matelda-Demo/datasets/QRM/hospital/dirty.csv"
)

print("Clean df shape:", clean_df.shape)
print("Dirty df shape:", dirty_df.shape)
print("Clean df columns:", clean_df.columns.tolist())
print("Dirty df columns:", dirty_df.columns.tolist())

# Check if there are any non-numeric indices
print("Clean df index:", type(clean_df.index), clean_df.index[:5])
print("Dirty df index:", type(dirty_df.index), dirty_df.index[:5])


# Remove index columns
def remove_index_columns(df):
    """Remove columns that appear to be index columns (like 1, 2, 3... or index)"""
    cols_to_remove = []
    for col in df.columns:
        if col.lower() in ["index", "tuple_id"] or col.isdigit():
            cols_to_remove.append(col)

    return df.drop(columns=cols_to_remove)


clean_df = remove_index_columns(clean_df)
dirty_df = remove_index_columns(dirty_df)

print("\nAfter removing index columns:")
print("Clean df shape:", clean_df.shape)
print("Clean df columns:", clean_df.columns.tolist())

# Test random sampling
total_rows = len(clean_df)
sample_size = 10
indices = np.random.choice(total_rows, size=sample_size, replace=False)
print(f"\nSample indices type: {type(indices)}")
print(f"Sample indices: {indices}")
print(f"Sample indices converted: {indices.tolist()}")

# Test if iloc works
try:
    test_sample = clean_df.iloc[indices.tolist()]
    print("iloc works with converted indices")
except Exception as e:
    print(f"Error with iloc: {e}")
