"""Explicit CPU/CUDA selection shared by the generator and photo encoder."""
import os


def configure_device(torch):
    requested = os.environ.get('CHECKFACE_DEVICE', 'cpu').strip().lower()
    if requested not in ('cpu', 'cuda'):
        raise ValueError('CHECKFACE_DEVICE must be cpu or cuda')
    if requested == 'cuda':
        if not torch.cuda.is_available():
            raise RuntimeError('CUDA requested but unavailable. Use the GPU Compose override, '
                               'install the NVIDIA Container Toolkit and check your host driver.')
        # Required by deterministic CUDA matrix multiplication; set before CUDA use.
        os.environ.setdefault('CUBLAS_WORKSPACE_CONFIG', ':4096:8')
        torch.backends.cuda.matmul.allow_tf32 = False
        torch.backends.cudnn.allow_tf32 = False
        torch.backends.cudnn.benchmark = False
    return torch.device(requested)


def device_status():
    import torch
    device = configure_device(torch)
    status = {'provider': device.type, 'torch_version': str(torch.__version__)}
    if device.type == 'cuda':
        status.update(gpu=torch.cuda.get_device_name(device),
                      gpu_capability=list(torch.cuda.get_device_capability(device)),
                      cuda_version=torch.version.cuda)
    return status
