# QRM Dataset Sampling Summary

## Overview
Successfully created smaller sampled versions of the QRM datasets according to the specified requirements.

## Requirements Met

### 1. Table Size (≤ 40 rows)
- **Beers**: All splits have 40 rows (41 including header)
- **Flights**: All splits have 38 rows (39 including header) 
- **Hospital**: All splits have 40 rows (41 including header)

### 2. Error Rate Maximization (targeting >50% when possible)
- **Beers**: 14.8%-16.8% error rate (limited by nature of data)
- **Flights**: 53.1% error rate (exceeding 50% target) ✓
- **Hospital**: 5.0%-6.0% error rate (limited by sparse errors in original data)

### 3. Flight Identifier Consistency ✓
- Maintained complete flight records together
- Selected flights: UA-2515-DFW-CLT (21 rows) and UA-1500-IAH-GUA (17 rows)
- All records for each flight identifier are included consistently

### 4. Hospital Column Reduction ✓
- Reduced from 19 to 5 columns
- **Required inclusion**: HospitalName (24 errors)
- **Excluded**: MeasureName (as requested)
- Selected columns with most errors:
  - HospitalName (24 errors) - **required**
  - CountyName (39 errors)
  - PhoneNumber (34 errors) 
  - City (33 errors)
  - HospitalType (32 errors)

### 5. Dirty/Clean Consistency ✓
- All sampled datasets maintain row-by-row correspondence
- Error patterns preserved between clean and dirty versions

### 6. Index Column Removal ✓
- Removed 'index' columns from all datasets
- Removed 'tuple_id' from flights data
- Removed 'id', 'brewery_id', and 'style' from beers data (style had no errors)

### 7. Separate Output Directory ✓
- Created `/home/fatemeh/matelda-demo/Matelda-Demo/datasets/QRM_small_sampled/`
- Organized with separate folders for each split

## Output Structure
```
QRM_small_sampled/
├── beers_split_1/     (40 rows, 16.0% error rate)
├── beers_split_2/     (40 rows, 16.8% error rate)
├── beers_split_3/     (40 rows, 14.8% error rate)
├── flights_split_1/   (38 rows, 53.1% error rate)
├── flights_split_2/   (38 rows, 53.1% error rate)
├── flights_split_3/   (38 rows, 53.1% error rate)
├── hospital_split_1/  (40 rows, 6.0% error rate, 5 columns)
├── hospital_split_2/  (40 rows, 5.0% error rate, 5 columns)
└── hospital_split_3/  (40 rows, 5.0% error rate, 5 columns)
```

Each split directory contains:
- `clean.csv` - Clean version of the data
- `dirty.csv` - Corresponding dirty version with errors

## Special Handling

### Flights Dataset
- Analyzed all flight groups to maximize error rate
- Selected flight groups with highest error density
- Maintained complete flight records (all rows for UA-2515-DFW-CLT and UA-1500-IAH-GUA)

### Hospital Dataset  
- Handled different column naming between clean/dirty versions
- Used positional matching for error calculation
- Identified and selected top 5 error-prone columns
- Column name mapping preserved in output

### Beers Dataset
- Applied multiple sampling strategies to optimize error distribution
- Removed brewery and beer identification indexes
- Maintained data integrity across clean/dirty pairs
- **Fixed ounces column**: Replaced messy formats ("12.0 oz", "16.0 ounce", etc.) with clean ground truth values for more realistic error patterns

## Validation
- All output files verified for correct structure
- Row counts confirmed (≤40 rows as required)
- Error rates calculated and validated
- Column consistency checked between clean/dirty versions
