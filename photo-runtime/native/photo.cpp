// Original dlib20.0.1 detector/predictor and e4e alignment geometry.
// Resampling is performed by unmodified Pillow12.3.0 kernels.
#include <dlib/image_processing/frontal_face_detector.h>
#include <dlib/image_processing/shape_predictor.h>
#include <dlib/image_transforms.h>
#include <dlib/image_io.h>
#include <cmath>
#include <memory>
#include <sstream>
#include <vector>
#include <algorithm>
#include <cstring>
#include <stdexcept>
#include "Imaging.h"
#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define EXPORT
#endif
using dlib::rgb_pixel;
namespace {
std::string last_error;
std::unique_ptr<dlib::shape_predictor> predictor;
std::unique_ptr<dlib::frontal_face_detector> detector;
dlib::array2d<rgb_pixel> input;
std::vector<std::vector<dlib::point>> landmarks;
std::vector<unsigned char> prepared;
struct MemoryBuffer:std::streambuf{MemoryBuffer(const unsigned char*p,size_t n){char*b=(char*)p;setg(b,b,b+n);}};
using Image=std::unique_ptr<ImagingMemoryInstance,decltype(&ImagingDelete)>;
Image image(Imaging p){if(!p)throw std::runtime_error("Bounded Pillow allocation/resample failed");return Image(p,ImagingDelete);}
double clip(double v,double a,double b){return std::min(b,std::max(a,v));}
struct Point{double x,y;Point operator+(Point v)const{return{x+v.x,y+v.y};}Point operator-(Point v)const{return{x-v.x,y-v.y};}Point operator*(double a)const{return{x*a,y*a};}};
struct Quad{Point p[4];double size;};
double norm(Point p){return std::hypot(p.x,p.y);}
Quad quad(const std::vector<dlib::point>&lm){
 Point l{0,0},r{0,0};for(int j=36;j<42;j++){l.x+=lm[j].x();l.y+=lm[j].y();}for(int j=42;j<48;j++){r.x+=lm[j].x();r.y+=lm[j].y();}l.x/=6.;l.y/=6.;r.x/=6.;r.y/=6.;
 Point eyes=(l+r)*.5,eyeToEye=r-l,mouth{(lm[48].x()+lm[54].x())*.5,(lm[48].y()+lm[54].y())*.5},eyeToMouth=mouth-eyes;
 Point x=eyeToEye-Point{-eyeToMouth.y,eyeToMouth.x};double length=norm(x);if(!(length>0))throw std::runtime_error("Degenerate face landmarks");
 x.x/=length;x.y/=length;x=x*std::max(norm(eyeToEye)*2.,norm(eyeToMouth)*1.8);Point y{-x.y,x.x},c=eyes+eyeToMouth*.1;
 return{{c-x-y,c-x+y,c+x+y,c+x-y},norm(x)*2.};
}
int reflect(int p,int n,bool half){if(n<=1)return 0;int period=half?2*n:2*n-2;p%=period;if(p<0)p+=period;return p<n?p:(half?period-p-1:period-p);}
void gaussian(std::vector<float>&out,const std::vector<float>&src,int w,int h,double sigma){
 // scipy.ndimage.gaussian_filter order=0, axes0 then1, reflect, truncate4.
 int radius=(int)(4.*sigma+.5);std::vector<double> kernel(radius*2+1);double total=0;
 for(int k=-radius;k<=radius;k++){double v=std::exp(-.5/(sigma*sigma)*(k*k));kernel[k+radius]=v;total+=v;}for(double &v:kernel)v/=total;
 std::vector<float> temp(src.size());out.resize(src.size());
 for(int axis=0;axis<2;axis++){const auto &in=axis?temp:src;auto &to=axis?out:temp;
  for(int y=0;y<h;y++)for(int x=0;x<w;x++)for(int c=0;c<3;c++){
   size_t at=((size_t)y*w+x)*3+c;double value=(double)in[at]*kernel[radius];
   for(int j=-radius;j<0;j++){
    int y1=axis?y:reflect(y+j,h,true),y2=axis?y:reflect(y-j,h,true),x1=axis?reflect(x+j,w,true):x,x2=axis?reflect(x-j,w,true):x;
    value+=((double)in[((size_t)y1*w+x1)*3+c]+(double)in[((size_t)y2*w+x2)*3+c])*kernel[j+radius];
   }to[at]=(float)value;
  }
 }
}
Image resized(Imaging in,int w,int h,int filter){float box[4]={0,0,(float)in->xsize,(float)in->ysize};return image(ImagingResample(in,w,h,filter,box));}
Image input_image(){auto out=image(ImagingNewDirty(IMAGING_MODE_RGB,input.nc(),input.nr()));for(long y=0;y<input.nr();y++)for(long x=0;x<input.nc();x++){auto p=input[y][x];unsigned char *to=(unsigned char*)out->image[y]+x*4;to[0]=p.red;to[1]=p.green;to[2]=p.blue;}return out;}
Image align(Imaging original,Quad q){
 auto im=image(ImagingCopy(original));int shrink=(int)std::floor(q.size/256.*.5);
 if(shrink>1){im=resized(im.get(),(int)std::nearbyint((double)im->xsize/shrink),(int)std::nearbyint((double)im->ysize/shrink),IMAGING_TRANSFORM_LANCZOS);for(auto &p:q.p){p.x/=shrink;p.y/=shrink;}q.size/=shrink;}
 auto bounds=[&](){double minx=q.p[0].x,miny=q.p[0].y,maxx=minx,maxy=miny;for(auto p:q.p){minx=std::min(minx,p.x);miny=std::min(miny,p.y);maxx=std::max(maxx,p.x);maxy=std::max(maxy,p.y);}return std::array<int,4>{(int)std::floor(minx),(int)std::floor(miny),(int)std::ceil(maxx),(int)std::ceil(maxy)};};
 int border=std::max((int)std::nearbyint(q.size*.1),3);auto b=bounds();std::array<int,4> crop{std::max(b[0]-border,0),std::max(b[1]-border,0),std::min(b[2]+border,im->xsize),std::min(b[3]+border,im->ysize)};
 if(crop[2]<=crop[0]||crop[3]<=crop[1])throw std::runtime_error("Face crop is outside the image");
 if(crop[2]-crop[0]<im->xsize||crop[3]-crop[1]<im->ysize){auto to=image(ImagingNewDirty(IMAGING_MODE_RGB,crop[2]-crop[0],crop[3]-crop[1]));for(int y=0;y<to->ysize;y++)memcpy(to->image[y],im->image[y+crop[1]]+crop[0]*4,to->linesize);im=std::move(to);for(auto &p:q.p)p=p-Point{(double)crop[0],(double)crop[1]};}
 b=bounds();std::array<int,4> pad{std::max(-b[0]+border,0),std::max(-b[1]+border,0),std::max(b[2]-im->xsize+border,0),std::max(b[3]-im->ysize+border,0)};
 if(*std::max_element(pad.begin(),pad.end())>border-4){
  for(auto &v:pad)v=std::max(v,(int)std::nearbyint(q.size*.3));int w=im->xsize+pad[0]+pad[2],h=im->ysize+pad[1]+pad[3];
  if(w<=0||h<=0||(size_t)w*h>4*1024*1024)throw std::runtime_error("Face padding exceeds alignment memory policy");
  std::vector<float> pixels((size_t)w*h*3),blurred;
  for(int y=0;y<h;y++)for(int x=0;x<w;x++){auto *p=(unsigned char*)im->image[reflect(y-pad[1],im->ysize,false)]+reflect(x-pad[0],im->xsize,false)*4;for(int c=0;c<3;c++)pixels[((size_t)y*w+x)*3+c]=p[c];}
  gaussian(blurred,pixels,w,h,q.size*.02);
  for(int y=0;y<h;y++)for(int x=0;x<w;x++){
   // numpy float32 coordinate arrays divided by int64 pads promote the mask to float64.
   double mask=std::max(1.-std::min((double)(float)x/pad[0],(double)(float)(w-1-x)/pad[2]),1.-std::min((double)(float)y/pad[1],(double)(float)(h-1-y)/pad[3]));
   for(int c=0;c<3;c++){size_t k=((size_t)y*w+x)*3+c;float difference=blurred[k]-pixels[k];pixels[k]=(float)((double)pixels[k]+(double)difference*clip(mask*3.+1.,0.,1.));}
  }
  blurred.clear();blurred.shrink_to_fit();float median[3];std::vector<float> channel((size_t)w*h);
  for(int c=0;c<3;c++){for(size_t i=0;i<channel.size();i++)channel[i]=pixels[i*3+c];size_t mid=channel.size()/2;std::nth_element(channel.begin(),channel.begin()+mid,channel.end());median[c]=channel[mid];if(channel.size()%2==0){float low=*std::max_element(channel.begin(),channel.begin()+mid);median[c]=(median[c]+low)*.5f;}}
  channel.clear();channel.shrink_to_fit();auto to=image(ImagingNewDirty(IMAGING_MODE_RGB,w,h));
  for(int y=0;y<h;y++)for(int x=0;x<w;x++){double mask=std::max(1.-std::min((double)(float)x/pad[0],(double)(float)(w-1-x)/pad[2]),1.-std::min((double)(float)y/pad[1],(double)(float)(h-1-y)/pad[3]));for(int c=0;c<3;c++){size_t k=((size_t)y*w+x)*3+c;float difference=median[c]-pixels[k];float v=(float)((double)pixels[k]+(double)difference*clip(mask,0.,1.));to->image[y][x*4+c]=(unsigned char)clip(std::nearbyint((double)v),0.,255.);}}
  im=std::move(to);for(auto &p:q.p)p=p+Point{(double)pad[0],(double)pad[1]};
 }
 for(auto &p:q.p)p=p+Point{.5,.5};double a[8]={q.p[0].x,(q.p[3].x-q.p[0].x)/256.,(q.p[1].x-q.p[0].x)/256.,(q.p[2].x-q.p[1].x-q.p[3].x+q.p[0].x)/65536.,q.p[0].y,(q.p[3].y-q.p[0].y)/256.,(q.p[1].y-q.p[0].y)/256.,(q.p[2].y-q.p[1].y-q.p[3].y+q.p[0].y)/65536.};
 auto out=image(ImagingNewDirty(IMAGING_MODE_RGB,256,256));if(!ImagingTransform(out.get(),im.get(),IMAGING_TRANSFORM_QUAD,0,0,256,256,a,IMAGING_TRANSFORM_BICUBIC,1))throw std::runtime_error("Pillow QUAD transform failed");return out;
}
template<typename Fn>int guarded(Fn fn){try{last_error.clear();return fn();}catch(const std::exception&e){last_error=e.what();return -1;}catch(...){last_error="Unknown alignment failure";return -1;}}
}
extern "C" {
EXPORT const char *cf_error(){return last_error.c_str();}
EXPORT int cf_init_predictor(const unsigned char *data,int length){return guarded([&](){if(length!=99693937)throw std::runtime_error("Unexpected landmark asset length");MemoryBuffer buf(data,length);std::istream stream(&buf);auto p=std::make_unique<dlib::shape_predictor>();dlib::deserialize(*p,stream);if(p->num_parts()!=68)throw std::runtime_error("Expected 68 landmarks");predictor=std::move(p);detector=std::make_unique<dlib::frontal_face_detector>(dlib::get_frontal_face_detector());return 0;});}
EXPORT int cf_set_rgb(const unsigned char *data,int w,int h){return guarded([&](){if(w<=0||h<=0||(size_t)w*h>4*1024*1024)throw std::runtime_error("Image exceeds four-megapixel alignment policy");input.set_size(h,w);for(int y=0;y<h;y++)for(int x=0;x<w;x++){auto*p=data+((size_t)y*w+x)*3;input[y][x]=rgb_pixel(p[0],p[1],p[2]);}landmarks.clear();prepared.clear();return 0;});}
EXPORT int cf_decode(const unsigned char *data,int length){return guarded([&](){if(length<8||length>25*1024*1024)throw std::runtime_error("Invalid image byte count");
 // The JS caller validates encoded dimensions before invoking a decoder.
 if(data[0]==137&&data[1]==80&&data[2]==78&&data[3]==71){dlib::array2d<dlib::rgb_alpha_pixel> decoded;dlib::load_png(decoded,data,length);input.set_size(decoded.nr(),decoded.nc());for(long y=0;y<input.nr();y++)for(long x=0;x<input.nc();x++){auto p=decoded[y][x];input[y][x]=rgb_pixel(p.red,p.green,p.blue);}}
 else if(data[0]==255&&data[1]==216)dlib::load_jpeg(input,data,length);
 else throw std::runtime_error("Choose a PNG or JPEG image");
 if(input.nr()<=0||input.nc()<=0||(size_t)input.nr()*input.nc()>4*1024*1024){input.clear();throw std::runtime_error("Image exceeds four-megapixel alignment policy");}landmarks.clear();prepared.clear();return 0;});}
EXPORT int cf_width(){return input.nc();} EXPORT int cf_height(){return input.nr();}
EXPORT int cf_detect(){return guarded([&](){if(!predictor||!detector)throw std::runtime_error("Landmarks have not been loaded");if(!input.size())throw std::runtime_error("No decoded image");landmarks.clear();dlib::pyramid_down<2> pyr;dlib::array2d<rgb_pixel> up;dlib::pyramid_up(input,up,pyr);std::vector<dlib::rect_detection>dets;(*detector)(up,dets,0.);up.clear();if(dets.size()>64)throw std::runtime_error("Too many detected faces");for(auto &det:dets){dlib::rectangle r=pyr.rect_down(det.rect,1);auto shape=(*predictor)(input,r);std::vector<dlib::point>lm;for(unsigned i=0;i<68;i++)lm.push_back(shape.part(i));landmarks.push_back(std::move(lm));}return landmarks.size();});}
EXPORT int cf_landmarks(int index,int *out){if(index<0||index>=(int)landmarks.size())return-1;for(int j=0;j<68;j++){out[j*2]=landmarks[index][j].x();out[j*2+1]=landmarks[index][j].y();}return 0;}
EXPORT int cf_prepare(int do_align){return guarded([&](){if(!input.size())throw std::runtime_error("No decoded image");auto original=input_image();bool aligned=do_align&&!landmarks.empty();Image out(nullptr,ImagingDelete);if(aligned){Quad best=quad(landmarks[0]);for(size_t i=1;i<landmarks.size();i++){auto q=quad(landmarks[i]);if(q.size>best.size)best=q;}out=align(original.get(),best);}else out=resized(original.get(),256,256,IMAGING_TRANSFORM_BILINEAR);prepared.resize(256*256*3);for(int y=0;y<256;y++)for(int x=0;x<256;x++)for(int c=0;c<3;c++)prepared[((size_t)y*256+x)*3+c]=(unsigned char)out->image[y][x*4+c];return aligned?1:0;});}
EXPORT const unsigned char *cf_prepared(){return prepared.data();}
EXPORT void cf_reset(){prepared.clear();prepared.shrink_to_fit();landmarks.clear();input.clear();predictor.reset();detector.reset();}
}
