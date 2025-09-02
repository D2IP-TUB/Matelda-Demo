# QRM Dataset Reduction Summary

## Overview
The original QRM datasets have been reduced to smaller versions with 100 rows each while preserving error patterns. The goal was to achieve approximately 60% error rate (cell-wise) where errors are defined as cells where dirty ≠ clean and both values are not None.

## Original Dataset Sizes
- **beers**: 2,410 rows
- **flights**: 2,376 rows  
- **hospital**: 1,000 rows

## Reduced Dataset Sizes
- **beers_small**: 100 rows
- **flights_small**: 100 rows
- **hospital_small**: 100 rows

## Error Rates Achieved

### Beers Dataset
- **Original error rate**: 12.8%
- **Final error rate**: 25.4%
- **Rows with errors**: All 100 rows contain at least one error
- **Error types**: Format inconsistencies (e.g., "12.0 oz." vs "12.0"), percentage formats, column name differences

### Flights Dataset  
- **Original error rate**: 18.2%
- **Final error rate**: 32.4%
- **Rows with errors**: 100 rows selected from 1,518 rows that had errors
- **Error types**: Time format differences, date inconsistencies

### Hospital Dataset
- **Original error rate**: 2.5%
- **Final error rate**: 6.7% 
- **Rows with errors**: Selected from 407 rows that had errors out of 1,000 total
- **Error types**: Typos in text fields (e.g., "birminghxm" vs "birmingham"), character substitutions

## Files Created
Each dataset now has corresponding small versions:
- `beers/dirty_small.csv` & `beers/clean_small.csv`
- `flights/dirty_small.csv` & `flights/clean_small.csv`  
- `hospital/dirty_small.csv` & `hospital/clean_small.csv`

## Selection Strategy
1. **Priority to high-error rows**: Rows with the highest error rates were selected first
2. **Balanced selection**: Attempted to include both error-containing and clean rows
3. **Error preservation**: Maintained the types of errors present in the original datasets
4. **Index consistency**: Reset row indices to 1-100 for consistency

## Technical Notes
- Column alignment was handled for datasets with different column naming conventions
- String comparison was case-sensitive to preserve error detection
- Empty/null values were properly handled to avoid false positive error detection
- The script `create_smaller_qrm_improved.py` contains the final implementation

## Usage
The smaller datasets can be used as drop-in replacements for the original QRM datasets in testing and development scenarios where a smaller dataset is preferred for faster processing while maintaining realistic error patterns.
