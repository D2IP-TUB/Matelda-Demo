# Ground Truth and User Labels: Correct Design

## The Problem

The original error detection system had a **fundamental design flaw** in how it handled different types of data:

### ❌ What Was Wrong:
1. **Ground Truth Contamination**: System was modifying ground truth with human labels
2. **Circular Evaluation**: Training on human labels, then evaluating against ground truth enhanced with the same human labels
3. **Conceptual Confusion**: Mixed training data (human labels) with evaluation data (ground truth)
4. **Invalid Treatment of User Labels**: User labels were sometimes treated as training data, sometimes as evaluation data, inconsistently

## The Correct Approach

### ✅ Data Type Classification:
1. **Ground Truth**: Base evaluation set (from CSV comparison) - SACRED, never modified
2. **User Labels**: High-quality annotations that serve as TRUSTED PREDICTIONS + training data
3. **Propagated Labels**: Lower-quality training data only
4. **All Other Cells**: Need ML prediction

### ✅ Correct Handling:

#### For Evaluation:
- **Cells with Ground Truth**: Evaluate against original ground truth
- **Cells with User Labels**: User label IS the prediction (perfect confidence, no ML needed)
- **Cells with Propagated Labels**: Evaluate ML prediction against ground truth (NOT propagated label)
- **All Other Cells**: Evaluate ML prediction against ground truth

#### For Training:
- **User Labels**: Use for training (high-quality examples)
- **Propagated Labels**: Use for training (additional examples)
- **Ground Truth**: NEVER used for training (evaluation only)

#### For Prediction:
- **Cells with User Labels**: Accept user label as prediction (no ML prediction)
- **All Other Cells**: Use ML prediction

## Key Changes Made

### 1. Proper Cell Classification
```python
# BEFORE: All cells treated the same way
all_predictions = {}

# AFTER: Different treatment based on data type
user_labeled_cells = set()      # Cells with direct user labels
cells_to_predict = set()        # Cells that need ML prediction
user_predictions = {}           # User labels as trusted predictions
ml_predictions = {}             # ML predictions for remaining cells
```

### 2. Separate Prediction Logic
```python
# User labels serve as trusted predictions (no ML needed)
user_predictions[cell_key] = is_error
cells_to_predict.discard(cell_key)  # Don't predict user-labeled cells

# Only run ML prediction on cells that need it
cells_needing_prediction = [
    cell for cell in column_cells 
    if (cell.table_id, cell.row_idx, cell.col_name) in cells_to_predict
]
```

### 3. Combined Final Predictions
```python
# Combine trusted user predictions with ML predictions
all_predictions = {}
all_predictions.update(user_predictions)  # User labels as trusted predictions
all_predictions.update(ml_predictions)    # ML predictions for remaining cells
```

### 4. Clean Evaluation
```python
# Evaluate against original ground truth (never contaminated)
metrics = _calculate_metrics_from_predictions(ground_truth, all_predictions, training_data)
```

## The Correct Flow

```
┌─────────────────┐
│   Load Data     │
└─────────────────┘
         │
         ▼
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  Ground Truth   │    │  User Labels     │    │ Propagated      │
│  (CSV compare)  │    │  (Human annot.)  │    │ Labels          │
│  EVALUATION     │    │  EVAL + TRAIN    │    │  TRAINING       │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│ Evaluation Set  │    │ Trusted          │    │ Training Data   │
│ (Original GT)   │    │ Predictions      │    │ (User + Prop)   │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                       │                       │
         │                       │                       ▼
         │                       │              ┌─────────────────┐
         │                       │              │ Train ML Model  │
         │                       │              └─────────────────┘
         │                       │                       │
         │                       │                       ▼
         │                       │              ┌─────────────────┐
         │                       │              │ ML Predictions  │
         │                       │              │ (Other cells)   │
         │                       │              └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────────────────────────────────────────────────────┐
│            Combine: Trusted + ML Predictions                    │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│            Evaluate Against Original Ground Truth               │
└─────────────────────────────────────────────────────────────────┘
```

## Why This is Correct

### Conceptual Clarity:
- **Ground Truth**: Objective reality for evaluation
- **User Labels**: High-quality annotations that don't need ML prediction
- **Propagated Labels**: Training data that still needs ML prediction for evaluation
- **ML Predictions**: System predictions for unlabeled data

### No Contamination:
- Training data (user + propagated labels) never used for evaluation
- Ground truth never modified or used for training
- User labels properly treated as trusted predictions

### Proper Evaluation:
- User-labeled cells: User label IS the prediction (perfect confidence)
- Other cells: ML prediction compared against ground truth
- No circular evaluation or train/test leakage

## Impact

This fix ensures that:
1. **Clean Separation**: Training and evaluation data are properly separated
2. **Trusted User Input**: User labels are treated as authoritative predictions
3. **Valid Metrics**: Performance reflects true system capability
4. **Sound Architecture**: Each data type has a clear, consistent purpose

The system now properly handles the different types of data according to their intended purposes and reliability levels.
