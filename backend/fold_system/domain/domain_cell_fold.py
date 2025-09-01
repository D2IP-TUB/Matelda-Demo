import logging
import re
from typing import Dict, List

import numpy as np
from nltk.corpus import stopwords
from sklearn.cluster import HDBSCAN
from transformers import BertModel, BertTokenizer

from ..core.base_fold import BaseCellFold
from ..core.cell import Cell

nltk_stopwords = set(stopwords.words("english"))
tokenizer = BertTokenizer.from_pretrained("bert-base-uncased")
model = BertModel.from_pretrained("bert-base-uncased")


class DomainCellFold(BaseCellFold):
    """Folds cells by semantic domain using BERT embeddings + HDBSCAN"""

    def __init__(self):
        super().__init__("domain")

    def preprocess_text(self, text):
        """Convert text to lowercase and remove stopwords"""
        text = text.lower()
        words = text.split()
        words = [word for word in words if word not in nltk_stopwords]
        return " ".join(words)

    def get_bert_embeddings(self, texts):
        """Get BERT embeddings for texts"""
        inputs = tokenizer(
            texts, return_tensors="pt", truncation=True, padding=True, max_length=512
        )
        outputs = model(**inputs)
        embeddings = outputs.last_hidden_state.mean(dim=1).squeeze().detach().numpy()
        return embeddings

    def fold_cells(self, cells: List[Cell]) -> Dict[str, List[Cell]]:
        """Fold cells into domain groups using BERT + HDBSCAN"""

        # Group cells by table first
        tables_cells = self._group_cells_by_table(cells)

        # Handle single table case - no clustering needed
        if len(tables_cells) == 1:
            table_id = list(tables_cells.keys())[0]
            logging.info(f"Single table detected: {table_id}, creating single domain")

            # Set domain for all cells
            for cell in tables_cells[table_id]:
                cell.domain = "domain_0"

            return {"domain_0": tables_cells[table_id]}

        # Multi-table case: proceed with clustering
        # Create documents from each table
        documents, table_names, table_cells_map = self._create_table_documents(
            tables_cells
        )

        # Get BERT embeddings
        embeddings = self._get_table_embeddings(documents)

        # Perform HDBSCAN clustering
        domain_clusters = self._cluster_tables(embeddings)

        # Map clusters back to cells
        domain_groups = self._map_clusters_to_cells(
            domain_clusters, table_names, table_cells_map
        )

        return domain_groups

    def _group_cells_by_table(self, cells: List[Cell]) -> Dict[str, List[Cell]]:
        """Group cells by table_id"""
        tables_cells = {}
        for cell in cells:
            if cell.table_id not in tables_cells:
                tables_cells[cell.table_id] = []
            tables_cells[cell.table_id].append(cell)
        return tables_cells

    def _create_table_documents(self, tables_cells: Dict[str, List[Cell]]) -> tuple:
        """Create text documents from table cells for BERT processing"""
        documents = []
        table_names = {}
        table_cells_map = {}

        for idx, (table_id, cells) in enumerate(tables_cells.items()):
            # Concatenate all cell values from this table
            table_text = " ".join([str(cell.dirty_value) for cell in cells])
            table_text = re.sub(r"\b\d+\.?\d*\b", "", table_text)
            processed_text = self.preprocess_text(table_text)

            documents.append(processed_text)
            table_names[idx] = table_id
            table_cells_map[table_id] = cells

        return documents, table_names, table_cells_map

    def _get_table_embeddings(
        self, documents: List[str], batch_size: int = 5
    ) -> np.ndarray:
        """Get BERT embeddings in batches"""
        embeddings = []

        for i in range(0, len(documents), batch_size):
            logging.debug(f"Processing batch {i} to {i + batch_size}")
            batch_texts = documents[i : i + batch_size]
            batch_embeddings = self.get_bert_embeddings(batch_texts)

            if len(batch_embeddings.shape) == 1:
                embeddings.extend([batch_embeddings.tolist()])
            else:
                embeddings.extend(batch_embeddings.tolist())

        return np.vstack(embeddings)

    def _cluster_tables(self, embeddings: np.ndarray) -> Dict[int, List[int]]:
        """Perform HDBSCAN clustering on embeddings"""
        dbscan = HDBSCAN(min_cluster_size=2)
        dbscan.fit(embeddings)

        max_clusters = max(set(dbscan.labels_))
        if max_clusters == -1:
            logging.info("No domain clusters found")
        else:
            logging.info(f"Number of domain clusters: {max_clusters + 1}")

        # Create cluster mapping
        clusters = {}
        for i, cluster_id in enumerate(dbscan.labels_):
            if cluster_id not in clusters:
                clusters[cluster_id] = []
            clusters[cluster_id].append(i)

        # Handle noise points (cluster_id = -1)
        if -1 in clusters:
            j = max_clusters + 1
            for table_idx in clusters[-1]:
                clusters[j] = [table_idx]
                j += 1
            clusters.pop(-1)

        return clusters

    def _map_clusters_to_cells(
        self,
        clusters: Dict[int, List[int]],
        table_names: Dict[int, str],
        table_cells_map: Dict[str, List[Cell]],
    ) -> Dict[str, List[Cell]]:
        """Map table clusters back to cell groups"""
        domain_groups = {}

        for cluster_id, table_indices in clusters.items():
            domain_name = f"domain_{cluster_id}"
            domain_groups[domain_name] = []

            # Get all cells from tables in this cluster
            for table_idx in table_indices:
                table_id = table_names[table_idx]
                table_cells = table_cells_map[table_id]

                # Set domain for each cell
                for cell in table_cells:
                    cell.domain = domain_name

                domain_groups[domain_name].extend(table_cells)

        return domain_groups
