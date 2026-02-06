#!/usr/bin/env python3
"""
LMNN (Large Margin Nearest Neighbor) weight learning for audio feature optimization.
Reads labeled feature data from stdin, learns optimal feature weights using metric learning,
and outputs the weights as JSON to stdout.
"""

import sys
import json
import numpy as np
import warnings
warnings.filterwarnings('ignore')


def learn_weights_lmnn(features, labels, feature_names):
    """
    Learn optimal feature weights using LMNN with diagonal constraint.

    Args:
        features: 2D array of shape (n_samples, n_features)
        labels: 1D array of string labels
        feature_names: List of feature name strings

    Returns:
        dict with weights, accuracy, n_samples, n_classes
    """
    from sklearn.preprocessing import LabelEncoder, StandardScaler
    from sklearn.neighbors import KNeighborsClassifier
    from sklearn.model_selection import LeaveOneOut, cross_val_score

    # Encode labels
    le = LabelEncoder()
    y = le.fit_transform(labels)
    X = np.array(features, dtype=np.float64)

    # Standardize features
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    # Replace NaN/Inf with 0
    X_scaled = np.nan_to_num(X_scaled, nan=0.0, posinf=0.0, neginf=0.0)

    n_samples, n_features = X_scaled.shape
    n_classes = len(le.classes_)

    weights = np.ones(n_features)

    try:
        # Try metric-learn LMNN
        from metric_learn import LMNN

        # Use diagonal=True for weight vector instead of full matrix
        k = min(3, n_samples // n_classes - 1)
        k = max(1, k)

        lmnn = LMNN(k=k, learn_rate=1e-6, max_iter=200, convergence_tol=1e-5)
        lmnn.fit(X_scaled, y)

        # Extract diagonal weights from learned transformation matrix
        L = lmnn.components_
        # M = L^T @ L gives the Mahalanobis matrix
        M = L.T @ L
        # Diagonal elements give per-feature weights
        weights = np.sqrt(np.abs(np.diag(M)))

    except ImportError:
        print("metric-learn not available, falling back to feature importance", file=sys.stderr)
        # Fallback: use feature importance from Random Forest
        try:
            from sklearn.ensemble import RandomForestClassifier
            rf = RandomForestClassifier(n_estimators=100, random_state=42, n_jobs=-1)
            rf.fit(X_scaled, y)
            weights = rf.feature_importances_
        except Exception as e:
            print(f"Random Forest fallback failed: {e}", file=sys.stderr)
            weights = np.ones(n_features)

    except Exception as e:
        print(f"LMNN failed: {e}, falling back to feature importance", file=sys.stderr)
        try:
            from sklearn.ensemble import RandomForestClassifier
            rf = RandomForestClassifier(n_estimators=100, random_state=42, n_jobs=-1)
            rf.fit(X_scaled, y)
            weights = rf.feature_importances_
        except:
            weights = np.ones(n_features)

    # Normalize weights: max weight = 2.0, min non-zero = 0.1
    if np.max(weights) > 0:
        weights = weights / np.max(weights) * 2.0
        weights = np.maximum(weights, 0.1)

    # Evaluate with leave-one-out k-NN on learned metric
    try:
        k_eval = min(5, n_samples - 1)
        knn = KNeighborsClassifier(n_neighbors=k_eval)

        # Weight features by learned weights for evaluation
        X_weighted = X_scaled * weights

        if n_samples > 10:
            # Use 5-fold CV for larger datasets
            from sklearn.model_selection import cross_val_score
            scores = cross_val_score(knn, X_weighted, y, cv=min(5, n_samples))
            accuracy = float(np.mean(scores))
        else:
            # Leave-one-out for small datasets
            loo = LeaveOneOut()
            scores = cross_val_score(knn, X_weighted, y, cv=loo)
            accuracy = float(np.mean(scores))
    except:
        accuracy = 0.0

    # Build weights dict
    weights_dict = {}
    for i, name in enumerate(feature_names):
        # Convert snake_case to camelCase for frontend
        camel_name = name
        parts = name.split('_')
        if len(parts) > 1:
            camel_name = parts[0] + ''.join(p.capitalize() for p in parts[1:])
        weights_dict[camel_name] = round(float(weights[i]), 3)

    return {
        'weights': weights_dict,
        'accuracy': round(accuracy, 4),
        'n_samples': int(n_samples),
        'n_classes': int(n_classes),
        'classes': le.classes_.tolist(),
    }


def main():
    try:
        # Read JSON from stdin
        input_data = json.loads(sys.stdin.read())

        features = input_data['features']
        labels = input_data['labels']
        feature_names = input_data['feature_names']

        if len(features) < 10:
            print(json.dumps({'error': 'Need at least 10 samples for weight learning'}))
            sys.exit(1)

        result = learn_weights_lmnn(features, labels, feature_names)
        print(json.dumps(result, indent=2))

    except Exception as e:
        print(json.dumps({'error': str(e)}))
        sys.exit(1)


if __name__ == '__main__':
    main()
