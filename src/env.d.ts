/// <reference types="astro/client" />

import type { JSX as PreactJSX } from "preact";

declare global {
  namespace JSX {
    type Element = PreactJSX.Element;
    interface IntrinsicAttributes extends PreactJSX.IntrinsicAttributes {}
    interface IntrinsicElements {
      a: PreactJSX.IntrinsicElements["a"];
      article: PreactJSX.IntrinsicElements["article"];
      button: PreactJSX.IntrinsicElements["button"];
      dd: PreactJSX.IntrinsicElements["dd"];
      details: PreactJSX.IntrinsicElements["details"];
      div: PreactJSX.IntrinsicElements["div"];
      dl: PreactJSX.IntrinsicElements["dl"];
      dt: PreactJSX.IntrinsicElements["dt"];
      fieldset: PreactJSX.IntrinsicElements["fieldset"];
      form: PreactJSX.IntrinsicElements["form"];
      h2: PreactJSX.IntrinsicElements["h2"];
      h3: PreactJSX.IntrinsicElements["h3"];
      h4: PreactJSX.IntrinsicElements["h4"];
      input: PreactJSX.IntrinsicElements["input"];
      label: PreactJSX.IntrinsicElements["label"];
      legend: PreactJSX.IntrinsicElements["legend"];
      li: PreactJSX.IntrinsicElements["li"];
      nav: PreactJSX.IntrinsicElements["nav"];
      ol: PreactJSX.IntrinsicElements["ol"];
      option: PreactJSX.IntrinsicElements["option"];
      p: PreactJSX.IntrinsicElements["p"];
      section: PreactJSX.IntrinsicElements["section"];
      select: PreactJSX.IntrinsicElements["select"];
      span: PreactJSX.IntrinsicElements["span"];
      strong: PreactJSX.IntrinsicElements["strong"];
      summary: PreactJSX.IntrinsicElements["summary"];
      ul: PreactJSX.IntrinsicElements["ul"];
    }
  }
}
