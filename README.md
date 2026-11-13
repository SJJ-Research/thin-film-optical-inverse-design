# Thin Film Optical Inverse Design

Find a material and wavelength for a target transmittance, reflectance and absorptance using reproduced CatBoost predictions.

[Open the interactive website](https://15800337764-maker.github.io/thin-film-optical-inverse-design/)

## Use

Enter target T, R and A percentages summing to 100%, choose materials and a wavelength range, and select **Find design**. The interface also includes forward prediction, optical spectra, target errors, CSV export and held-out model validation.

- Materials: Au, Sn, Mo, Ni, Cu and Al.
- Wavelength range: 248–2000 nm, at 1 nm steps.
- No login, Python installation or server-side computation is required.
- To run offline, download this repository and open `index.html`.
- `inverse-design-source.zip` contains the model, source data, export scripts, checks and detailed methodology.

## Interpretation

The search uses predictions from the reproduced forward model. The predictions are not clipped, normalized or filtered for energy conservation. Design tolerance measures deviation from a requested target; the reported 95% confidence intervals concern held-out MAE, not individual design predictions.

## Sources

Thomas et al., *Enhanced prediction and optimization of thin metal film optical properties using optimized ensemble learning models*, Scientific Reports 15, 43523 (2025).

- [Paper](https://doi.org/10.1038/s41598-025-27524-6)
- [Original public code and data](https://github.com/kevint992-debug/OptiM-AI)
- [Author's application source](https://huggingface.co/spaces/kevint992/OptiM-AI/blob/main/app.py)

This is an independent reproduction and inverse-design extension, not the authors' official application. Original research and data are attributed to their authors.
