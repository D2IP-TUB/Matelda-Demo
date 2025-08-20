import ast
import re
from typing import List, Tuple


class ErrorDetectionParser:
    def __init__(self):
        # Strategy mapping dictionaries
        self.detector_types = {
            "OD": "Outlier Detector",
            "RVD_orig": "Rule Violation Detector",
        }

        self.od_methods = {"histogram": "Histogram", "gaussian": "Gaussian"}

    def parse_line(self, line: str) -> Tuple[str, List]:
        """Parse a single line to extract the strategy list."""
        # Remove line numbers and extra characters
        cleaned_line = re.sub(r"^\d+\s*=\s*", "", line.strip())
        cleaned_line = cleaned_line.strip("'\"")

        try:
            # Parse as Python literal
            parsed = ast.literal_eval(cleaned_line)
            return parsed[0], parsed[1]
        except (ValueError, SyntaxError, IndexError):
            print(f"Warning: Could not parse line: {line}")
            return None, None

    def format_strategy(self, detector_type: str, strategy_params: List) -> str:
        """Convert strategy parameters to readable format."""
        if detector_type == "OD":
            # Outlier Detector
            method = strategy_params[0] if strategy_params else "unknown"
            method_name = self.od_methods.get(method, method.capitalize())
            return f"{self.detector_types[detector_type]} - {method_name}"

        elif detector_type == "RVD_orig":
            # Rule Violation Detector
            if len(strategy_params) >= 2:
                rule_type = strategy_params[0]
                rule_target = strategy_params[1]
                return f"{self.detector_types[detector_type]}, Violated Rule: {rule_type} -> {rule_target}"
            else:
                return f"{self.detector_types[detector_type]}, Rule: {strategy_params[0] if strategy_params else 'unknown'}"

        # else:
        # Unknown detector type
        # return f"Unknown Detector: {detector_type}, Parameters: {strategy_params}"

    def parse_strategies(self, input_list: List[str]) -> List[str]:
        """Parse the entire input list and return formatted strategies."""
        strategies = []
        seen_strategies = set()  # To avoid duplicates

        for line in input_list:
            if line.strip():
                detector_type, strategy_params = self.parse_line(line)
                if detector_type and strategy_params:
                    formatted = self.format_strategy(detector_type, strategy_params)
                    if formatted not in seen_strategies:
                        strategies.append(formatted)
                        seen_strategies.add(formatted)

        return strategies

    def parse(self, input_list: List[str]):
        """Parse and print the strategies in a readable format."""
        strategies = self.parse_strategies(input_list)

        # print("Error Detection Strategies Found:")
        # print("-" * 50)
        # for i, strategy in enumerate(strategies, 1):
        #     print(f"{i}. {strategy}")

        return strategies


# Example usage
# if __name__ == "__main__":
#     parser = ErrorDetectionParser()

#     # Your sample input as a list
#     sample_input = [
#         '["OD", ["histogram", "0.1", "0.7"]]',
#         '1 =\'["OD", ["histogram", "0.5", "0.7"]]\'',
#         '2 =\'["OD", ["histogram", "0.5", "0.9"]]\'',
#         '3 =\'["OD", ["histogram", "0.3", "0.9"]]\'',
#         '4 =\'["RVD_orig", ["rules", "end_time"]]\'',
#         '5 =\'["OD", ["histogram", "0.1", "0.9"]]\'',
#         '6 =\'["RVD_orig", ["rated", "end_time"]]\'',
#         '7 =\'["OD", ["histogram", "0.3", "0.7"]]\'',
#         '8 =\'["OD", ["histogram", "0.1", "0.5"]]\'',
#     ]

#     # Parse and display results
#     strategies = parser.parse_and_print(sample_input)

#     print("\nUnique strategies as list:")
#     for strategy in strategies:
#         print(f"- {strategy}")
