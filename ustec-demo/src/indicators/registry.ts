export type IndicatorId = 'sonicR';

export type IndicatorDefinition = {
  id: IndicatorId;
  label: string;
  defaultEnabled: boolean;
};

export const indicatorDefinitions: IndicatorDefinition[] = [
  { id: 'sonicR', label: 'Sonic R', defaultEnabled: false },
];

