import type { State } from '../state.ts';
import type { Msg } from '../msg.ts';
import type { Transition } from '../effects.ts';
export function slider(message: Msg, state: State): Transition | null {
  switch (message.type) {
    case 'UseSliderToggle': {
      const [enabled] = message.args;
      return {
        state: { ...state, UseSlider: enabled },
        effects: [
          { type: 'rememberSlider', enabled, frame: state.SliderFrame },
          ...(enabled && state.SliderFrames === null && state.VideoUrl
            ? [{ type: 'sliderFrames' as const }]
            : []),
        ],
      };
    }
    case 'SliderLoaded':
      return { state: { ...state, SliderFrames: message.args[0] }, effects: [] };
    case 'SliderFrameSet': {
      const frame = Math.max(1, message.args[0]);
      return {
        state: { ...state, SliderFrame: frame },
        effects: [{ type: 'rememberSlider', enabled: state.UseSlider, frame }],
      };
    }
    default:
      return null;
  }
}
