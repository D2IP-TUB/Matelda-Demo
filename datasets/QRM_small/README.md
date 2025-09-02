# QRM Small Datasets

This folder contains reduced versions of the QRM datasets, each with exactly 100 rows (plus header) to enable faster processing while preserving realistic error patterns.

## Structure
```
QRM_small/
├── beers/
│   ├── clean.csv    (100 rows)
│   └── dirty.csv    (100 rows)
├── flights/
│   ├── clean.csv    (100 rows)
│   └── dirty.csv    (100 rows)
├── hospital/
│   ├── clean.csv    (100 rows)
│   └── dirty.csv    (100 rows)
└── README.md
```

## Dataset Statistics

| Dataset  | Rows | Error Rate | Original Size | Original Error Rate |
|----------|------|------------|---------------|---------------------|
| beers    | 100  | 25.4%      | 2,410        | 12.8%              |
| flights  | 100  | 32.4%      | 2,376        | 18.2%              |
| hospital | 100  | 6.7%       | 1,000        | 2.5%               |

## Error Definition
Errors are defined as cells where `dirty_value ≠ clean_value` and both values are not None/null.

## Selection Methodology
- **Priority selection**: Rows with highest error rates were selected first
- **Error preservation**: Maintained the same types of errors as the original datasets
- **Balanced sampling**: Included both error-containing and clean rows where possible

## Usage
These smaller datasets can be used as drop-in replacements for the full QRM datasets in:
- Development and testing
- Algorithm prototyping  
- Educational demonstrations
- Performance benchmarking with faster execution

## Original Source
Generated from `/datasets/QRM/` using the dataset reduction scripts in the project root.
