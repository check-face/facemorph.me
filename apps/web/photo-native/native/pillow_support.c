// RGB-only ownership adapter for unmodified Pillow Geometry.c / Resample.c.
#include "Imaging.h"
static const char *error_message;
int isModeI16(ModeID mode){return mode==IMAGING_MODE_I_16||mode==IMAGING_MODE_I_16L||mode==IMAGING_MODE_I_16B||mode==IMAGING_MODE_I_16N;}
void *ImagingError_MemoryError(void){error_message="Pillow allocation failed";return NULL;}
void *ImagingError_ModeError(void){error_message="Pillow RGB mode required";return NULL;}
void *ImagingError_Mismatch(void){error_message="Pillow image mismatch";return NULL;}
void *ImagingError_ValueError(const char *s){error_message=s;return NULL;}
void ImagingSectionEnter(ImagingSectionCookie *cookie){*cookie=NULL;}
void ImagingSectionLeave(ImagingSectionCookie *cookie){(void)cookie;}
void ImagingCopyPalette(Imaging dst,Imaging src){(void)dst;(void)src;}
Imaging ImagingNewDirty(ModeID mode,int w,int h){
 if(mode!=IMAGING_MODE_RGB||w<=0||h<=0||w>8192||h>8192||(size_t)w*h>8*1024*1024)return ImagingError_ValueError("Pillow image exceeds bounded RGB dimensions");
 Imaging im=calloc(1,sizeof(*im));if(!im)return ImagingError_MemoryError();
 im->mode=mode;im->type=IMAGING_TYPE_UINT8;im->bands=3;im->xsize=w;im->ysize=h;im->pixelsize=4;im->linesize=w*4;
 im->block=calloc((size_t)h,im->linesize);im->image=malloc((size_t)h*sizeof(char*));
 if(!im->block||!im->image){free(im->block);free(im->image);free(im);return ImagingError_MemoryError();}
 for(int y=0;y<h;y++)im->image[y]=im->block+(size_t)y*im->linesize;im->image32=(INT32**)im->image;
 return im;
}
void ImagingDelete(Imaging im){if(im){free(im->block);free(im->image);free(im);}}
Imaging ImagingCopy(Imaging src){Imaging dst=ImagingNewDirty(src->mode,src->xsize,src->ysize);if(dst)memcpy(dst->block,src->block,(size_t)src->ysize*src->linesize);return dst;}
