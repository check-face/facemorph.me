# model-conv: StyleGAN2 checkpoint -> browser provider artifacts (fm-uh14). CPU reference toolchain.
# Build:  docker build -t facemorph/model-conv packages/model-conv   (see docs/usage.md)
# No weights, credentials or generated artifacts enter this image; checkpoints are mounted read-only at run.
ARG BASE_IMAGE=python:3.12-slim@sha256:a0f57064cbdcd6285fa45f51237ab0b35ea8ebaed06a1f5973e89e19dfb86704
FROM ${BASE_IMAGE}
ARG BASE_IMAGE

ARG UPSTREAM_REVISION=d72cc7d041b42ec8e806021a205ed9349f87c6a4
ARG UPSTREAM_SHA256=e09a4f09499bad8019d87b18b6ce19c91c0ae6d82e8a7af1fc16b22b4f9ebbba
ENV PYTHONDONTWRITEBYTECODE=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1 \
    MODEL_CONV_UPSTREAM=/opt/upstream/stylegan2-ada-pytorch HOME=/tmp \
    MODEL_CONV_BASE_IMAGE=${BASE_IMAGE}

COPY requirements.lock /opt/model-conv/requirements.lock
RUN pip install --require-hashes --no-deps --extra-index-url https://download.pytorch.org/whl/cpu -r /opt/model-conv/requirements.lock

# Pinned upstream source, checked against its recorded archive digest.
ADD --checksum=sha256:${UPSTREAM_SHA256} \
    https://github.com/NVlabs/stylegan2-ada-pytorch/archive/${UPSTREAM_REVISION}.tar.gz /tmp/upstream.tar.gz
RUN mkdir -p /opt/upstream && tar -xzf /tmp/upstream.tar.gz -C /opt/upstream && rm /tmp/upstream.tar.gz \
 && mv /opt/upstream/stylegan2-ada-pytorch-${UPSTREAM_REVISION} /opt/upstream/stylegan2-ada-pytorch

COPY model_conv /opt/model-conv/model_conv
COPY NOTICE.md PROVENANCE.json /opt/model-conv/
WORKDIR /opt/model-conv
ENV PYTHONPATH=/opt/model-conv
ENTRYPOINT ["python", "-m", "model_conv"]
