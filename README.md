# Demonstrating Matelda for Multi-Table Error Detection

Real-world datasets are often fragmented across multiple heterogeneous tables, managed by different teams or organizations. Ensuring data quality in such environments is challenging, as traditional error detection tools typically operate on isolated tables and overlook cross-table relationships. To address this gap, we investigate how cleaning multiple tables simultaneously, combined with structured user collaboration, can reduce annotation effort and enhance the effectiveness and efficiency of error detection.

We present Matelda, an interactive system for multi-table error detection that combines automated error detection with human-in-the-loop refinement. Matelda guides users through Inspection \& Action, allowing them to explore system-generated insights, refine decisions, and annotate data with contextual support. It organizes tables using domain-based and quality-based folding and leverages semi-supervised learning to propagate labels across related tables efficiently. Our demonstration showcases Matelda’s capabilities for collaborative error detection and resolution by leveraging shared knowledge, contextual similarity, and structured user interactions across multiple tables.


## Screenshots 

![Pipeline](https://github.com/D2IP-TUB/Matelda-Demo/blob/main/Screenshots/pipeline-git.png)
![Labeling](https://github.com/D2IP-TUB/Matelda-Demo/blob/main/Screenshots/labeling-git.png)

## Video

Link to the Vide: https://github.com/D2IP-TUB/Matelda-Demo/blob/main/Video/Matelda-Demo.mp4

## Installation 

1. First you need to install [miniconda](https://docs.conda.io/en/latest/miniconda.html), and "aspell".

2. Setup the repository.
```
git clone git@github.com:D2IP-TUB/Matelda.git
cd Matelda
make install
```
3. Adapt the config.ini file to the needs of your datalake.
4. Start Matelda
```
make run
```

You will find the results in the results folder and the performance metrics at the end of the log.

## Utilities

Uninstall:
```
make uninstall
```
## Support and Contributions
If you encounter any issues while using Matelda or have suggestions for improvements, please open an issue in our GitHub repository. We welcome contributions from the community and encourage you to submit pull requests to help us enhance Matelda further.

Thank you for choosing *Matelda for efficient data lake cleaning. We believe that this approach will significantly improve the quality of your data while saving you time and resources. Happy data cleaning!
