// collect-fields.browser.js 가 반환하는 구조

export type FieldContext = {
  label: string;
  ariaLabel: string;
  ariaLabelledBy: string;
  placeholder: string;
  title: string;
  rowHeader: string;
  preceding: string;
  section: string;
  sections: string[];
};

export type Field = {
  index: number;
  tag: string;
  type: string;
  role: string;
  name: string;
  id: string;
  selector: string;
  visible: boolean;
  required: boolean;
  disabled: boolean;
  readonly: boolean;
  context: FieldContext;
  attrs: {
    maxLength: number | null;
    pattern: string;
    autocomplete: string;
    inputmode: string;
    className: string;
    onclick: string;
    dataType: string;
    relTarget: string;
    dateHint: string;
  };
  options?: { value: string; text: string; selected: boolean }[];
  optionCount?: number;
  checked?: boolean;
  value?: string;
  hasValue?: boolean;
  valueLength?: number;
  valueShape?: string;
};

export type FrameDump = {
  url: string;
  title?: string;
  headings?: string[];
  fieldCount?: number;
  fields?: Field[];
  buttons?: { text: string; selector: string; visible: boolean; section: string }[];
  error?: string;
};
